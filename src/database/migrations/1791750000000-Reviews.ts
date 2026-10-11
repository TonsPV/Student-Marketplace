import { MigrationInterface, QueryRunner, Table } from "typeorm";

export class Reviews1791750000000 implements MigrationInterface {
  name = "Reviews1791750000000";

  private tableName(queryRunner: QueryRunner): string {
    const schema =
      (queryRunner.connection.options as { schema?: string }).schema ??
      "public";
    if (!/^[a-z][a-z0-9_]*$/.test(schema))
      throw new Error("Invalid POSTGRES_SCHEMA");
    return `${schema}.reviews`;
  }

  async up(queryRunner: QueryRunner): Promise<void> {
    const name = this.tableName(queryRunner);
    const schema = name.split(".")[0];
    await queryRunner.createTable(
      new Table({
        name,
        columns: [
          { name: "id", type: "uuid", isPrimary: true },
          { name: "reviewer_id", type: "uuid" },
          { name: "post_id", type: "uuid" },
          { name: "rating", type: "integer" },
          { name: "comment", type: "text", isNullable: true },
          { name: "created_at", type: "timestamp", default: "now()" },
          { name: "updated_at", type: "timestamp", default: "now()" },
        ],
        indices: [
          {
            name: "uq_reviews_reviewer_post",
            columnNames: ["reviewer_id", "post_id"],
            isUnique: true,
          },
          {
            name: "idx_reviews_post_created_at",
            columnNames: ["post_id", "created_at"],
          },
        ],
        foreignKeys: [
          {
            name: "fk_reviews_reviewer",
            columnNames: ["reviewer_id"],
            referencedTableName: `${schema}.user`,
            referencedColumnNames: ["id"],
            onDelete: "RESTRICT",
          },
          {
            name: "fk_reviews_post",
            columnNames: ["post_id"],
            referencedTableName: `${schema}.posts`,
            referencedColumnNames: ["id"],
            onDelete: "RESTRICT",
          },
        ],
      }),
      true,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const name = this.tableName(queryRunner);
    if (!(await queryRunner.hasTable(name))) return;
    const schema = name.split(".")[0];
    const rows = await queryRunner.query(
      `SELECT 1 FROM "${schema}"."reviews" LIMIT 1`,
    );
    if (rows.length)
      throw new Error("Cannot downgrade while reviews contain user data");
    await queryRunner.dropTable(name);
  }
}
