import { assertIndependentMigrationRollback } from "../schema/unify-post-promotions";
import { MigrationInterface, QueryRunner } from "typeorm";

export class PostLifecycle1791810000000 implements MigrationInterface {
  name = "PostLifecycle1791810000000";

  private schema(runner: QueryRunner) {
    const schema =
      (runner.connection.options as { schema?: string }).schema ?? "public";
    if (!/^[a-z][a-z0-9_]*$/.test(schema))
      throw new Error("Invalid POSTGRES_SCHEMA");
    return schema;
  }

  async up(runner: QueryRunner): Promise<void> {
    const schema = this.schema(runner);
    await runner.query(
      `ALTER TYPE "${schema}"."posts_status_enum" ADD VALUE IF NOT EXISTS 'expired'`,
    );
    await runner.query(
      `ALTER TYPE "${schema}"."notifications_type_enum" ADD VALUE IF NOT EXISTS 'post_expiring'`,
    );
    await runner.query(
      `ALTER TYPE "${schema}"."notifications_type_enum" ADD VALUE IF NOT EXISTS 'post_expired'`,
    );
    // Another branch may already own expires_at. Preserve every known deadline;
    // only legacy rows without one receive the agreed 14-day grace period.
    await runner.query(`ALTER TABLE "${schema}".posts
      ADD COLUMN IF NOT EXISTS published_at timestamptz,
      ADD COLUMN IF NOT EXISTS expires_at timestamptz,
      ADD COLUMN IF NOT EXISTS renewal_count integer DEFAULT 0`);
    await runner.query(`UPDATE "${schema}".posts SET
      published_at = COALESCE(published_at, CASE WHEN expires_at IS NULL THEN CURRENT_TIMESTAMP ELSE LEAST(CURRENT_TIMESTAMP, expires_at - interval '336 hours') END),
      expires_at = COALESCE(expires_at, COALESCE(published_at, CURRENT_TIMESTAMP) + interval '336 hours'),
      renewal_count = COALESCE(renewal_count, 0)
      WHERE published_at IS NULL OR expires_at IS NULL OR renewal_count IS NULL`);
    await runner.query(`ALTER TABLE "${schema}".posts
      ALTER COLUMN published_at SET DEFAULT CURRENT_TIMESTAMP,
      ALTER COLUMN published_at SET NOT NULL,
      ALTER COLUMN expires_at SET DEFAULT (now() + interval '336 hours'),
      ALTER COLUMN expires_at SET NOT NULL,
      ALTER COLUMN renewal_count SET DEFAULT 0,
      ALTER COLUMN renewal_count SET NOT NULL,
      DROP CONSTRAINT IF EXISTS chk_posts_lifetime`);
    await runner.query(
      `ALTER TABLE "${schema}".posts ADD CONSTRAINT chk_posts_lifetime CHECK (expires_at > published_at AND renewal_count >= 0)`,
    );
    // Text comparisons permit using the new enum label in a transactional migration.
    await runner.query(
      `ALTER TABLE "${schema}".posts DROP CONSTRAINT IF EXISTS chk_posts_transaction_state`,
    );
    await runner.query(`ALTER TABLE "${schema}".posts ADD CONSTRAINT chk_posts_transaction_state CHECK (
      (buyer_id IS NULL OR buyer_id <> seller_id) AND (
        (status::text = 'sold' AND sold_at IS NOT NULL)
        OR (status::text IN ('active', 'expired') AND buyer_id IS NULL AND sold_at IS NULL)
        OR (status::text = 'hidden' AND (sold_at IS NOT NULL OR buyer_id IS NULL))
      ))`);
    await runner.query(
      `CREATE INDEX IF NOT EXISTS idx_posts_seller_status_expires ON "${schema}".posts (seller_id, status, expires_at) WHERE deleted_at IS NULL`,
    );
    await runner.query(
      `CREATE INDEX IF NOT EXISTS idx_posts_status_expires ON "${schema}".posts (status, expires_at) WHERE deleted_at IS NULL`,
    );
    await runner.query(`CREATE TABLE IF NOT EXISTS "${schema}".post_renewals (
      id uuid PRIMARY KEY,
      post_id uuid NOT NULL REFERENCES "${schema}".posts(id) ON DELETE RESTRICT,
      renewal_number integer NOT NULL,
      kind varchar(10) NOT NULL,
      payment_reference varchar(150),
      previous_expires_at timestamptz NOT NULL,
      published_at timestamptz NOT NULL,
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT chk_post_renewals_number CHECK (renewal_number > 0),
      CONSTRAINT chk_post_renewals_kind CHECK (
        (kind = 'free' AND renewal_number = 1 AND payment_reference IS NULL)
        OR (kind = 'paid' AND renewal_number > 1 AND payment_reference IS NOT NULL)
      )
    )`);
    await runner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_post_renewals_cycle ON "${schema}".post_renewals (post_id, renewal_number)`,
    );
    await runner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_post_renewals_payment ON "${schema}".post_renewals (payment_reference) WHERE payment_reference IS NOT NULL`,
    );
    await runner.query(`ALTER TABLE "${schema}".notifications
      ADD COLUMN IF NOT EXISTS target_type varchar(30), ADD COLUMN IF NOT EXISTS dedup_key varchar(200)`);
    await runner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_dedup_key ON "${schema}".notifications (dedup_key) WHERE dedup_key IS NOT NULL`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    await assertIndependentMigrationRollback(runner, this.name);
    const schema = this.schema(runner);
    // Old code has no expired status; restore its original active-state semantics.
    await runner.query(
      `UPDATE "${schema}".posts SET status = 'active' WHERE status::text = 'expired'`,
    );
    await runner.query(
      `ALTER TABLE "${schema}".posts DROP CONSTRAINT chk_posts_transaction_state`,
    );
    await runner.query(`ALTER TABLE "${schema}".posts ADD CONSTRAINT chk_posts_transaction_state CHECK (
      (buyer_id IS NULL OR buyer_id <> seller_id) AND (
        (status::text = 'sold' AND sold_at IS NOT NULL)
        OR (status::text = 'active' AND buyer_id IS NULL AND sold_at IS NULL)
        OR (status::text = 'hidden' AND (sold_at IS NOT NULL OR buyer_id IS NULL))
      ))`);
    await runner.query(`DROP TABLE "${schema}".post_renewals`);
    await runner.query(
      `DROP INDEX "${schema}".idx_posts_seller_status_expires`,
    );
    await runner.query(`DROP INDEX "${schema}".idx_posts_status_expires`);
    await runner.query(`ALTER TABLE "${schema}".posts DROP CONSTRAINT chk_posts_lifetime,
      DROP COLUMN published_at, DROP COLUMN expires_at, DROP COLUMN renewal_count`);
    await runner.query(
      `DELETE FROM "${schema}".notifications WHERE type::text IN ('post_expiring', 'post_expired')`,
    );
    await runner.query(
      `ALTER TABLE "${schema}".notifications DROP COLUMN target_type, DROP COLUMN dedup_key`,
    );
    // PostgreSQL enum labels are retained, as in ReviewRequestNotification.down.
  }
}
