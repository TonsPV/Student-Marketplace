import { QueryRunner } from "typeorm";

/** Converge both promotion models without recreating tables or changing lifetimes. */
export async function unifyPostPromotions(q: QueryRunner): Promise<void> {
  const schema =
    (q.connection.options as { schema?: string }).schema ?? "public";
  if (!/^[a-z][a-z0-9_]*$/.test(schema))
    throw new Error("Invalid POSTGRES_SCHEMA");
  const table = `"${schema}"."post_promotions"`;
  if (!(await q.hasColumn(`${schema}.posts`, "expires_at")))
    throw new Error(
      "PostLifecycle migration must run before promotion convergence",
    );
  if (!(await q.hasTable(`${schema}.post_promotions`)))
    throw new Error(
      "PaymentsPromotions migration must run before promotion convergence",
    );
  for (const [oldName, newName] of [
    ["post_id", "postId"],
    ["starts_at", "startsAt"],
    ["ends_at", "endsAt"],
  ]) {
    if (await q.hasColumn(`${schema}.post_promotions`, oldName)) {
      if (await q.hasColumn(`${schema}.post_promotions`, newName))
        throw new Error(`Ambiguous promotion columns: ${oldName}/${newName}`);
      await q.query(
        `ALTER TABLE ${table} RENAME COLUMN "${oldName}" TO "${newName}"`,
      );
    }
    if (!(await q.hasColumn(`${schema}.post_promotions`, newName)))
      throw new Error(`Missing promotion column: ${newName}`);
  }
  await q.query(`ALTER TABLE ${table}
    ADD COLUMN IF NOT EXISTS "orderId" uuid,
    ADD COLUMN IF NOT EXISTS created_by_id uuid,
    ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
    ADD COLUMN IF NOT EXISTS cancelled_by_id uuid,
    ADD COLUMN IF NOT EXISTS created_at timestamptz`);
  await q.query(
    `ALTER TABLE ${table} ALTER COLUMN "orderId" DROP NOT NULL, ALTER COLUMN created_by_id DROP NOT NULL`,
  );
  await q.query(`UPDATE ${table} p SET created_by_id=COALESCE(
    (SELECT o."ownerId" FROM "${schema}".payment_orders o WHERE o.id=p."orderId"),
    (SELECT post.seller_id FROM "${schema}".posts post WHERE post.id=p."postId")) WHERE p.created_by_id IS NULL`);
  await q.query(
    `UPDATE ${table} SET created_at="startsAt" WHERE created_at IS NULL`,
  );
  await q.query(
    `ALTER TABLE ${table} ALTER COLUMN created_at SET DEFAULT now(), ALTER COLUMN created_at SET NOT NULL`,
  );
  const current = await q.getTable(`${schema}.post_promotions`);
  if (!current) throw new Error("Promotion table missing");
  if (
    !current.uniques.some(
      (u) => u.columnNames.length === 1 && u.columnNames[0] === "orderId",
    )
  )
    await q.query(
      `ALTER TABLE ${table} ADD CONSTRAINT uq_post_promotions_order UNIQUE("orderId")`,
    );
  for (const [column, target] of [
    ["postId", "posts"],
    ["orderId", "payment_orders"],
    ["created_by_id", "user"],
    ["cancelled_by_id", "user"],
  ]) {
    if (
      !current.foreignKeys.some(
        (f) => f.columnNames.length === 1 && f.columnNames[0] === column,
      )
    )
      await q.query(
        `ALTER TABLE ${table} ADD CONSTRAINT "fk_post_promotions_${column}" FOREIGN KEY ("${column}") REFERENCES "${schema}"."${target}"(id) ON DELETE RESTRICT`,
      );
  }
  for (const [name, check] of [
    ["chk_post_promotions_window", '"endsAt">"startsAt"'],
    [
      "chk_post_promotions_source",
      '"orderId" IS NOT NULL OR created_by_id IS NOT NULL',
    ],
    [
      "chk_post_promotions_cancel",
      "(cancelled_at IS NULL AND cancelled_by_id IS NULL) OR (cancelled_at IS NOT NULL AND cancelled_by_id IS NOT NULL)",
    ],
  ]) {
    if (!current.checks.some((c) => c.name === name))
      await q.query(
        `ALTER TABLE ${table} ADD CONSTRAINT "${name}" CHECK (${check})`,
      );
  }
  if (
    !current.indices.some(
      (index) =>
        index.columnNames.length === 2 &&
        index.columnNames[0] === "postId" &&
        index.columnNames[1] === "endsAt",
    )
  ) {
    await q.query(
      `CREATE INDEX IF NOT EXISTS idx_post_promotions_post_window ON ${table}("postId","endsAt")`,
    );
  }
}

/** An adopted branch's columns/history cannot be removed by reverting its prerequisites. */
export async function assertIndependentMigrationRollback(
  q: QueryRunner,
  name: string,
): Promise<void> {
  const options = q.connection.options as {
    schema?: string;
    migrationsTableName?: string;
  };
  const schema = options.schema ?? "public",
    table = options.migrationsTableName ?? "migrations";
  if (
    !/^[a-z][a-z0-9_]*$/.test(schema) ||
    !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)
  )
    throw new Error("Invalid migration history table");
  if (!(await q.hasTable(`${schema}.${table}`))) return;
  const rows: Array<{ id: number; name: string }> = await q.query(
    `SELECT id,name FROM "${schema}"."${table}" WHERE name IN ($1,$2)`,
    [name, "PostExpiryAndPromotions1791830000000"],
  );
  const own = rows.find((row) => row.name === name),
    adopted = rows.find(
      (row) => row.name === "PostExpiryAndPromotions1791830000000",
    );
  if (own && adopted && adopted.id < own.id)
    throw new Error(
      "Cannot automatically revert a migration that adopted an existing branch schema; use a reviewed forward migration",
    );
}
