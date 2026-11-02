import { MigrationInterface, QueryRunner } from "typeorm";
import {
  unifyPostPromotions,
  assertIndependentMigrationRollback,
} from "../schema/unify-post-promotions";
export class PaymentsPromotions1791810000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    const schema =
      (q.connection.options as { schema?: string }).schema ?? "public";
    if (!/^[a-z][a-z0-9_]*$/.test(schema))
      throw new Error("Invalid POSTGRES_SCHEMA");
    await q.query(
      `CREATE TABLE IF NOT EXISTS "${schema}".payment_orders (id uuid PRIMARY KEY, "ownerId" uuid NOT NULL REFERENCES "${schema}"."user"(id), "postId" uuid NOT NULL REFERENCES "${schema}".posts(id), "packageCode" varchar NOT NULL, amount integer NOT NULL CHECK(amount>0), hours integer NOT NULL CHECK(hours IN (24,48,72)), "txnRef" varchar NOT NULL UNIQUE, "idempotencyKey" varchar NOT NULL, status varchar NOT NULL DEFAULT 'pending', fulfillment varchar NOT NULL DEFAULT 'pending', reason text, "transactionNo" varchar UNIQUE, "paymentUrl" text NOT NULL, "expiresAt" timestamptz NOT NULL, "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(), UNIQUE("ownerId","idempotencyKey"))`,
    );
    await q.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_pending_post ON "${schema}".payment_orders ("postId") WHERE status = 'pending'`,
    );
    await q.query(
      `CREATE TABLE IF NOT EXISTS "${schema}".payment_requests (id uuid PRIMARY KEY, "ownerId" uuid NOT NULL REFERENCES "${schema}"."user"(id), key varchar NOT NULL, "orderId" uuid NOT NULL REFERENCES "${schema}".payment_orders(id), "postId" uuid NOT NULL REFERENCES "${schema}".posts(id), "packageCode" varchar NOT NULL, UNIQUE("ownerId",key))`,
    );
    if (!(await q.hasTable(`${schema}.post_promotions`))) {
      await q.query(
        `CREATE TABLE "${schema}".post_promotions (id uuid PRIMARY KEY, "postId" uuid NOT NULL REFERENCES "${schema}".posts(id), "orderId" uuid NOT NULL UNIQUE REFERENCES "${schema}".payment_orders(id), "startsAt" timestamptz NOT NULL, "endsAt" timestamptz NOT NULL, CHECK("endsAt">"startsAt"))`,
      );
      await q.query(
        `CREATE INDEX ON "${schema}".post_promotions ("postId","endsAt")`,
      );
    } else if (await q.hasColumn(`${schema}.posts`, "expires_at")) {
      // Adopt admin campaign history; do not recreate or discard its rows.
      await unifyPostPromotions(q);
    }
  }

  async down(q: QueryRunner): Promise<void> {
    await assertIndependentMigrationRollback(
      q,
      "PaymentsPromotions1791810000000",
    );
    await q.query("DROP TABLE post_promotions");
    await q.query("DROP TABLE payment_requests");
    await q.query("DROP TABLE payment_orders");
  }
}
