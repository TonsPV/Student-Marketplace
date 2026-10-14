import { MigrationInterface, QueryRunner } from "typeorm";

export class ReviewRequestNotification1791770000000 implements MigrationInterface {
  name = "ReviewRequestNotification1791770000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "notifications_type_enum" ADD VALUE IF NOT EXISTS 'review_request'`,
    );
  }

  async down(): Promise<void> {
    // PostgreSQL cannot remove an enum value without recreating the type.
  }
}
