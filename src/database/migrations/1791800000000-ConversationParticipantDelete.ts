import { MigrationInterface, QueryRunner } from "typeorm";

export class ConversationParticipantDelete1791800000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE conversations
      ADD COLUMN buyer_deleted_at timestamptz,
      ADD COLUMN seller_deleted_at timestamptz`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE conversations
      DROP COLUMN seller_deleted_at,
      DROP COLUMN buyer_deleted_at`);
  }
}
