import { MigrationInterface, QueryRunner } from "typeorm";
import { unifyPostPromotions } from "../schema/unify-post-promotions";

/** Lifecycle owns expires_at. Merge admin campaigns into the existing paid history. */
export class PostExpiryAndPromotions1791830000000 implements MigrationInterface {
  name = "PostExpiryAndPromotions1791830000000";
  async up(q: QueryRunner): Promise<void> {
    await unifyPostPromotions(q);
  }
  async down(_q: QueryRunner): Promise<void> {
    // Shared with payments/lifecycle: reverting this migration must not delete
    // their columns, paid campaigns, or administrative audit history.
  }
}
