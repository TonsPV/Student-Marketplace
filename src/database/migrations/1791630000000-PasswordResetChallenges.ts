import { MigrationInterface, QueryRunner } from "typeorm";

export class PasswordResetChallenges1791630000000 implements MigrationInterface {
  name = "PasswordResetChallenges1791630000000";
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE password_reset_challenges (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      otp_hash varchar(64), otp_expires_at timestamptz NOT NULL,
      failed_attempts integer NOT NULL DEFAULT 0, status varchar(16) NOT NULL DEFAULT 'pending',
      reset_token_hash varchar(64), reset_token_expires_at timestamptz,
      consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT chk_password_reset_status CHECK (status IN ('pending', 'active', 'verified', 'consumed', 'invalidated', 'failed')),
      CONSTRAINT chk_password_reset_attempts CHECK (failed_attempts BETWEEN 0 AND 5)
    )`);
    await queryRunner.query(
      `CREATE INDEX idx_password_reset_user_created ON password_reset_challenges (user_id, created_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_password_reset_created ON password_reset_challenges (created_at)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX idx_password_reset_token_hash ON password_reset_challenges (reset_token_hash)`,
    );
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE password_reset_challenges`);
  }
}
