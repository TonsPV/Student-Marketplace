import { MigrationInterface, QueryRunner } from "typeorm";
export class PaymentsPromotions1791810000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TABLE payment_orders (id uuid PRIMARY KEY, "ownerId" uuid NOT NULL REFERENCES "user"(id), "postId" uuid NOT NULL REFERENCES posts(id), "packageCode" varchar NOT NULL, amount integer NOT NULL CHECK(amount>0), hours integer NOT NULL CHECK(hours IN (24,48,72)), "txnRef" varchar NOT NULL UNIQUE, "idempotencyKey" varchar NOT NULL, status varchar NOT NULL DEFAULT 'pending', fulfillment varchar NOT NULL DEFAULT 'pending', reason text, "transactionNo" varchar UNIQUE, "paymentUrl" text NOT NULL, "expiresAt" timestamptz NOT NULL, "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(), UNIQUE("ownerId","idempotencyKey"))`,
    );
    await q.query(
      `CREATE UNIQUE INDEX uq_payment_pending_post ON payment_orders ("postId") WHERE status = 'pending'`,
    );
    await q.query(
      `CREATE TABLE payment_requests (id uuid PRIMARY KEY, "ownerId" uuid NOT NULL REFERENCES "user"(id), key varchar NOT NULL, "orderId" uuid NOT NULL REFERENCES payment_orders(id), "postId" uuid NOT NULL REFERENCES posts(id), "packageCode" varchar NOT NULL, UNIQUE("ownerId",key))`,
    );
    await q.query(
      `CREATE TABLE post_promotions (id uuid PRIMARY KEY, "postId" uuid NOT NULL REFERENCES posts(id), "orderId" uuid NOT NULL UNIQUE REFERENCES payment_orders(id), "startsAt" timestamptz NOT NULL, "endsAt" timestamptz NOT NULL, CHECK("endsAt">"startsAt"))`,
    );
    await q.query(`CREATE INDEX ON post_promotions ("postId","endsAt")`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query("DROP TABLE post_promotions");
    await q.query("DROP TABLE payment_requests");
    await q.query("DROP TABLE payment_orders");
  }
}
