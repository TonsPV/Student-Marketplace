import { MigrationInterface, QueryRunner, Table } from "typeorm";

export class ReviewEditHistories1791810000000 implements MigrationInterface {
  name = "ReviewEditHistories1791810000000";

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
    await queryRunner.createTable(
      new Table({
        name: `${schema}.review_edit_histories`,
        columns: [
          { name: "id", type: "uuid", isPrimary: true },
          { name: "review_id", type: "uuid" },
          { name: "editor_id", type: "uuid" },
          { name: "old_rating", type: "integer" },
          { name: "new_rating", type: "integer" },
          { name: "old_comment", type: "text", isNullable: true },
          { name: "new_comment", type: "text", isNullable: true },
          { name: "revision", type: "integer" },
          {
            name: "edited_at",
            type: "timestamptz",
            default: "CURRENT_TIMESTAMP",
          },
        ],
        indices: [
          {
            name: "uq_review_edit_histories_review_revision",
            columnNames: ["review_id", "revision"],
            isUnique: true,
          },
        ],
        foreignKeys: [
          {
            name: "fk_review_edit_histories_review",
            columnNames: ["review_id"],
            referencedTableName: `${schema}.reviews`,
            referencedColumnNames: ["id"],
            onDelete: "RESTRICT",
          },
          {
            name: "fk_review_edit_histories_editor",
            columnNames: ["editor_id"],
            referencedTableName: `${schema}.user`,
            referencedColumnNames: ["id"],
            onDelete: "RESTRICT",
          },
        ],
      }),
      true,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const schema = this.schema(queryRunner);
    const table = `${schema}.review_edit_histories`;
    if (await queryRunner.hasTable(table)) {
      await queryRunner.dropTable(table);
    }
  }
}
