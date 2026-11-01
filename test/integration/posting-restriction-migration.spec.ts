import { DataSource, QueryRunner, Table } from "typeorm";
import { randomUUID } from "crypto";
import { PostingRestrictions1791820000000 } from "../../src/database/migrations/1791820000000-PostingRestrictions";
import { UserEntity } from "../../src/modules/user/user.entity";
import {
  createTestDataSource,
  disposeTestDatabase,
  initializeTestDatabase,
  ownedTestSchema,
} from "./database";
import { createTestUser } from "./fixtures";

const names = (table: Table | undefined) => ({
  checks: (table?.checks ?? []).map((c) => c.name).sort(),
  indices: (table?.indices ?? []).map((i) => i.name).sort(),
  foreignKeys: (table?.foreignKeys ?? []).map((f) => f.name).sort(),
});

/** Read-only probe: which of `tables` exist in `public` (never written). */
async function publicTables(runner: QueryRunner, tables: string[]) {
  const rows = (await runner.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY($1)
      ORDER BY table_name`,
    [tables],
  )) as Array<{ table_name: string }>;
  return rows.map((row) => row.table_name);
}

describe("posting restrictions migration", () => {
  let ds: DataSource;
  let runner: QueryRunner;
  let schema: string;
  const migration = new PostingRestrictions1791820000000();

  beforeAll(async () => {
    ds = createTestDataSource();
    await initializeTestDatabase(ds);
    schema = ownedTestSchema(ds);
    runner = ds.createQueryRunner();
    await runner.connect();
  });

  afterAll(async () => {
    if (runner) await runner.release();
    if (ds) await disposeTestDatabase(ds);
  });

  it("creates both tables only in the test schema, matching the entities", async () => {
    const tables = ["posting_restrictions", "user_warnings"];
    const fromEntities = await Promise.all(
      tables.map(async (t) => names(await runner.getTable(`${schema}.${t}`))),
    );
    for (const t of tables) await runner.query(`DROP TABLE "${schema}"."${t}"`);
    const publicBefore = await publicTables(runner, tables);

    await migration.up(runner);

    const located = (await runner.query(
      `SELECT table_schema, table_name FROM information_schema.tables
        WHERE table_name = ANY($1) AND table_schema = $2 ORDER BY table_name`,
      [tables, schema],
    )) as Array<{ table_name: string }>;
    expect(located.map((row) => row.table_name)).toEqual(tables);
    // The migration resolves its schema from the connection, never `public`.
    expect(publicBefore).toEqual(await publicTables(runner, tables));
    const fromMigration = await Promise.all(
      tables.map(async (t) => names(await runner.getTable(`${schema}.${t}`))),
    );
    expect(fromMigration).toEqual(fromEntities);

    const restrictions = await runner.getTable(
      `${schema}.posting_restrictions`,
    );
    expect(restrictions?.foreignKeys.map((f) => f.onDelete)).toEqual(
      Array(4).fill("RESTRICT"),
    );
    expect(
      restrictions?.indices.find(
        (i) => i.name === "idx_posting_restrictions_user_unlifted",
      )?.where,
    ).toContain("lifted_at");
  });

  it("enforces CHECK and FK constraints at the database level", async () => {
    const [user, admin] = [await createTestUser(ds), await createTestUser(ds)];
    const insert = (values: Record<string, unknown>) => {
      const row = {
        id: randomUUID(),
        user_id: user.id,
        type: "TEMPORARY",
        reason: "Spam",
        starts_at: new Date("2026-01-01T00:00:00Z"),
        expires_at: new Date("2026-01-02T00:00:00Z"),
        issued_by_id: admin.id,
        ...values,
      };
      const cols = Object.keys(row);
      return runner.query(
        `INSERT INTO "${schema}"."posting_restrictions" (${cols.map((c) => `"${c}"`).join(", ")})
         VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
        Object.values(row),
      );
    };
    const check = { driverError: { code: "23514" } };

    await expect(insert({})).resolves.toBeDefined();
    await expect(
      insert({ type: "PERMANENT", expires_at: null }),
    ).resolves.toBeDefined();
    await expect(insert({ type: "WARNING" })).rejects.toMatchObject(check);
    await expect(insert({ expires_at: null })).rejects.toMatchObject(check);
    await expect(
      insert({ expires_at: new Date("2026-01-01T00:00:00Z") }),
    ).rejects.toMatchObject(check);
    await expect(insert({ type: "PERMANENT" })).rejects.toMatchObject(check);
    await expect(insert({ reason: "   " })).rejects.toMatchObject(check);
    await expect(insert({ issued_by_id: user.id })).rejects.toMatchObject(
      check,
    );
    await expect(insert({ lifted_at: new Date() })).rejects.toMatchObject(
      check,
    );
    await expect(
      insert({
        lifted_at: new Date(),
        lifted_by_id: admin.id,
        lift_reason: " ",
      }),
    ).rejects.toMatchObject(check);
    await expect(
      insert({
        lifted_at: new Date(),
        lifted_by_id: user.id,
        lift_reason: "ok",
      }),
    ).rejects.toMatchObject(check);
    await expect(insert({ user_id: randomUUID() })).rejects.toMatchObject({
      driverError: { code: "23503" },
    });
    await expect(
      runner.query(
        `INSERT INTO "${schema}"."user_warnings" (id, user_id, reason, issued_by_id)
         VALUES ($1, $2, 'x', $2)`,
        [randomUUID(), user.id],
      ),
    ).rejects.toMatchObject(check);
    // History pins the user row: hard delete is refused.
    await expect(
      ds.getRepository(UserEntity).delete(user.id),
    ).rejects.toMatchObject({
      driverError: { code: "23503" },
    });
  });

  it("refuses to roll back while history exists, then rolls back cleanly", async () => {
    await expect(migration.down(runner)).rejects.toThrow(
      "moderation history contains data",
    );
    expect(await runner.hasTable(`${schema}.posting_restrictions`)).toBe(true);
    await runner.query(
      `TRUNCATE "${schema}"."posting_restrictions", "${schema}"."user_warnings"`,
    );
    await migration.down(runner);
    expect(await runner.hasTable(`${schema}.posting_restrictions`)).toBe(false);
    expect(await runner.hasTable(`${schema}.user_warnings`)).toBe(false);
    expect(await runner.hasTable(`${schema}.user`)).toBe(true);
    expect(await runner.hasTable(`${schema}.reports`)).toBe(true);
  });
});
