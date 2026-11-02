import { MigrationInterface, QueryRunner } from "typeorm";

export class ModerationWarningsAndCancelledBoosts1791850000000 implements MigrationInterface {
  name = "ModerationWarningsAndCancelledBoosts1791850000000";

  async up(runner: QueryRunner): Promise<void> {
    const schema =
      (runner.connection.options as { schema?: string }).schema ?? "public";
    if (!/^[a-z][a-z0-9_]*$/.test(schema))
      throw new Error("Invalid POSTGRES_SCHEMA");
    await runner.query(
      `ALTER TYPE "${schema}".notifications_type_enum ADD VALUE IF NOT EXISTS 'moderation_warning'`,
    );
    await runner.query(`UPDATE "${schema}".payment_orders orders
      SET fulfillment = 'requires_review', reason = 'promotion_cancelled_by_admin', "updatedAt" = clock_timestamp()
      FROM "${schema}".post_promotions promotion
      WHERE promotion."orderId" = orders.id AND promotion.cancelled_at IS NOT NULL
        AND orders.status = 'paid' AND orders.fulfillment = 'active'`);
  }

  async down(): Promise<void> {
    // Financial review/audit records must not be silently reverted. PostgreSQL
    // enum labels are additive; leaving an unused label is safe on rollback.
  }
}
