import { MigrationInterface, QueryRunner } from "typeorm";

export class AvatarStorageKey1791740000000 implements MigrationInterface {
  name = "AvatarStorageKey1791740000000";

  private table(queryRunner: QueryRunner): string {
    const schema =
      (queryRunner.connection.options as { schema?: string }).schema ??
      "public";
    if (!/^[a-z][a-z0-9_]*$/.test(schema))
      throw new Error("Invalid POSTGRES_SCHEMA");
    return `"${schema}"."user"`;
  }

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE ${this.table(queryRunner)} ADD COLUMN "avatar_storage_key" varchar(256)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const table = this.table(queryRunner);
    const rows = await queryRunner.query(
      `SELECT 1 FROM ${table} WHERE "avatar_storage_key" IS NOT NULL LIMIT 1`,
    );
    if (rows.length)
      throw new Error(
        "Cannot downgrade while uploaded avatars contain user data",
      );
    await queryRunner.query(
      `ALTER TABLE ${table} DROP COLUMN "avatar_storage_key"`,
    );
  }
}
