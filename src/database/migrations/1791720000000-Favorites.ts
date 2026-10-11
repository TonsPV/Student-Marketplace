import { MigrationInterface, QueryRunner, Table } from "typeorm";

export class Favorites1791720000000 implements MigrationInterface {
  name = "Favorites1791720000000";

  private tableName(queryRunner: QueryRunner): string {
    const schema =
      (queryRunner.connection.options as { schema?: string }).schema ??
      "public";
    if (!/^[a-z][a-z0-9_]*$/.test(schema))
      throw new Error("Invalid POSTGRES_SCHEMA");
    return `${schema}.favorites`;
  }

  async up(queryRunner: QueryRunner): Promise<void> {
    const name = this.tableName(queryRunner);
    const schema = name.split(".")[0];
    await queryRunner.createTable(
      new Table({
        name,
        columns: [
          { name: "id", type: "uuid", isPrimary: true },
          { name: "user_id", type: "uuid" },
          { name: "post_id", type: "uuid" },
          { name: "created_at", type: "timestamp", default: "now()" },
        ],
        uniques: [
          {
            name: "uq_favorites_user_post",
            columnNames: ["user_id", "post_id"],
          },
        ],
        indices: [
          {
            name: "idx_favorites_user_created",
            columnNames: ["user_id", "created_at", "id"],
          },
          { name: "idx_favorites_post_id", columnNames: ["post_id"] },
        ],
        foreignKeys: [
          {
            name: "fk_favorites_user",
            columnNames: ["user_id"],
            referencedTableName: `${schema}.user`,
            referencedColumnNames: ["id"],
            onDelete: "CASCADE",
          },
          {
            name: "fk_favorites_post",
            columnNames: ["post_id"],
            referencedTableName: `${schema}.posts`,
            referencedColumnNames: ["id"],
            onDelete: "CASCADE",
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
      `SELECT 1 FROM "${schema}"."favorites" LIMIT 1`,
    );
    if (rows.length)
      throw new Error("Cannot downgrade while favorites contain user data");
    await queryRunner.dropTable(name);
  }
}
