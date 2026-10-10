import { MigrationInterface, QueryRunner } from "typeorm";

export class PostImageUploads1791600000000 implements MigrationInterface {
  name = "PostImageUploads1791600000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE post_image ADD COLUMN storage_key varchar(256)`,
    );
    await queryRunner.query(
      `ALTER TABLE post_image ALTER COLUMN url DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE post_image ADD CONSTRAINT chk_post_image_source
       CHECK ((url IS NULL) <> (storage_key IS NULL))`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const rows = await queryRunner.query(
      `SELECT 1 FROM post_image WHERE storage_key IS NOT NULL LIMIT 1`,
    );
    if (rows.length) {
      throw new Error(
        "Cannot downgrade while post images use R2 keys; migrate them to permanent URLs first",
      );
    }
    await queryRunner.query(
      `ALTER TABLE post_image DROP CONSTRAINT chk_post_image_source`,
    );
    await queryRunner.query(
      `ALTER TABLE post_image ALTER COLUMN url SET NOT NULL`,
    );
    await queryRunner.query(`ALTER TABLE post_image DROP COLUMN storage_key`);
  }
}
