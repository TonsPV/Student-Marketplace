import { MigrationInterface, QueryRunner, Table } from "typeorm";

/**
 * Warning + posting restriction history (Phase 1).
 * Separate from `user.is_locked`; this migration does not touch it.
 */
export class PostingRestrictions1791820000000 implements MigrationInterface {
  name = "PostingRestrictions1791820000000";

  private schema(queryRunner: QueryRunner): string {
    const schema =
      (queryRunner.connection.options as { schema?: string }).schema ??
      "public";
    if (!/^[a-z][a-z0-9_]*$/.test(schema)) {
      throw new Error("Invalid POSTGRES_SCHEMA");
    }
    return schema;
  }

  async up(queryRunner: QueryRunner): Promise<void> {
    const schema = this.schema(queryRunner);
    await queryRunner.createTable(this.userWarningsTable(schema), true);
    await queryRunner.createTable(this.postingRestrictionsTable(schema), true);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const schema = this.schema(queryRunner);
    const tables = ["posting_restrictions", "user_warnings"] as const;
    // Moderation history must never be lost by a rollback.
    for (const table of tables) {
      if (!(await queryRunner.hasTable(`${schema}.${table}`))) continue;
      const rows = (await queryRunner.query(
        `SELECT 1 FROM "${schema}"."${table}" LIMIT 1`,
      )) as unknown[];
      if (rows.length) {
        throw new Error(
          "Cannot downgrade while moderation history contains data",
        );
      }
    }
    for (const table of tables) {
      if (await queryRunner.hasTable(`${schema}.${table}`)) {
        await queryRunner.dropTable(`${schema}.${table}`);
      }
    }
  }

  private userWarningsTable(schema: string): Table {
    return new Table({
      name: `${schema}.user_warnings`,
      columns: [
        { name: "id", type: "uuid", isPrimary: true },
        { name: "user_id", type: "uuid" },
        { name: "reason", type: "text" },
        { name: "issued_by_id", type: "uuid" },
        { name: "source_report_id", type: "uuid", isNullable: true },
        {
          name: "created_at",
          type: "timestamptz",
          default: "CURRENT_TIMESTAMP",
        },
      ],
      checks: [
        {
          name: "chk_user_warnings_reason_not_blank",
          expression: `btrim("reason") <> ''`,
        },
        {
          name: "chk_user_warnings_not_self",
          expression: `"issued_by_id" <> "user_id"`,
        },
      ],
      indices: [
        {
          name: "idx_user_warnings_user_created",
          columnNames: ["user_id", "created_at"],
        },
      ],
      foreignKeys: [
        this.fk("fk_user_warnings_user", "user_id", `${schema}.user`),
        this.fk("fk_user_warnings_issued_by", "issued_by_id", `${schema}.user`),
        this.fk(
          "fk_user_warnings_source_report",
          "source_report_id",
          `${schema}.reports`,
        ),
      ],
    });
  }

  private fk(name: string, column: string, referencedTableName: string) {
    return {
      name,
      columnNames: [column],
      referencedTableName,
      referencedColumnNames: ["id"],
      onDelete: "RESTRICT",
    };
  }

  private postingRestrictionsTable(schema: string): Table {
    return new Table({
      name: `${schema}.posting_restrictions`,
      columns: [
        { name: "id", type: "uuid", isPrimary: true },
        { name: "user_id", type: "uuid" },
        { name: "type", type: "varchar", length: "20" },
        { name: "reason", type: "text" },
        { name: "starts_at", type: "timestamptz" },
        { name: "expires_at", type: "timestamptz", isNullable: true },
        { name: "issued_by_id", type: "uuid" },
        { name: "source_report_id", type: "uuid", isNullable: true },
        { name: "lifted_at", type: "timestamptz", isNullable: true },
        { name: "lifted_by_id", type: "uuid", isNullable: true },
        { name: "lift_reason", type: "text", isNullable: true },
        {
          name: "created_at",
          type: "timestamptz",
          default: "CURRENT_TIMESTAMP",
        },
      ],
      checks: [
        {
          name: "chk_posting_restrictions_type",
          expression: `"type" IN ('TEMPORARY', 'PERMANENT')`,
        },
        {
          name: "chk_posting_restrictions_expiry",
          expression: `("type" = 'PERMANENT' AND "expires_at" IS NULL) OR ("type" = 'TEMPORARY' AND "expires_at" IS NOT NULL AND "expires_at" > "starts_at")`,
        },
        {
          name: "chk_posting_restrictions_reason_not_blank",
          expression: `btrim("reason") <> ''`,
        },
        {
          name: "chk_posting_restrictions_lift",
          expression: `("lifted_at" IS NULL AND "lifted_by_id" IS NULL AND "lift_reason" IS NULL) OR ("lifted_at" IS NOT NULL AND "lifted_by_id" IS NOT NULL AND "lift_reason" IS NOT NULL AND btrim("lift_reason") <> '')`,
        },
        {
          name: "chk_posting_restrictions_not_self",
          expression: `"issued_by_id" <> "user_id" AND ("lifted_by_id" IS NULL OR "lifted_by_id" <> "user_id")`,
        },
      ],
      indices: [
        {
          name: "idx_posting_restrictions_user_unlifted",
          columnNames: ["user_id", "starts_at"],
          where: `"lifted_at" IS NULL`,
        },
        {
          name: "idx_posting_restrictions_user_created",
          columnNames: ["user_id", "created_at"],
        },
      ],
      foreignKeys: [
        this.fk("fk_posting_restrictions_user", "user_id", `${schema}.user`),
        this.fk(
          "fk_posting_restrictions_issued_by",
          "issued_by_id",
          `${schema}.user`,
        ),
        this.fk(
          "fk_posting_restrictions_lifted_by",
          "lifted_by_id",
          `${schema}.user`,
        ),
        this.fk(
          "fk_posting_restrictions_source_report",
          "source_report_id",
          `${schema}.reports`,
        ),
      ],
    });
  }
}
