import { MigrationInterface, QueryRunner } from "typeorm";

export class UserUniversityPostLocationName1791730000000 implements MigrationInterface {
  name = "UserUniversityPostLocationName1791730000000";

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
    await queryRunner.query(
      `ALTER TABLE "${schema}"."user" ADD COLUMN "university" varchar(150)`,
    );
    await queryRunner.query(
      `ALTER TABLE "${schema}"."posts" ADD COLUMN "location_name" varchar(255)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const schema = this.schema(queryRunner);
    // Check both columns before dropping either so a refused rollback is non-destructive.
    const rows = await queryRunner.query(
      `SELECT 1 FROM "${schema}"."user" WHERE "university" IS NOT NULL
       UNION ALL
       SELECT 1 FROM "${schema}"."posts" WHERE "location_name" IS NOT NULL
       LIMIT 1`,
    );
    if (rows.length) {
      throw new Error(
        "Cannot downgrade while university or locationName contain user data",
      );
    }
    await queryRunner.query(
      `ALTER TABLE "${schema}"."posts" DROP COLUMN "location_name"`,
    );
    await queryRunner.query(
      `ALTER TABLE "${schema}"."user" DROP COLUMN "university"`,
    );
  }
}
