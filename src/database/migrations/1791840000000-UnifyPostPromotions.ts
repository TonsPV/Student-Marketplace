import { MigrationInterface, QueryRunner } from "typeorm";
import { unifyPostPromotions } from "../schema/unify-post-promotions";

/** Also repairs databases which had already applied the original 179183 migration. */
export class UnifyPostPromotions1791840000000 implements MigrationInterface {
  name = "UnifyPostPromotions1791840000000";
  async up(q: QueryRunner): Promise<void> {
    await unifyPostPromotions(q);
  }
  async down(_q: QueryRunner): Promise<void> {
    // Additive compatibility repair. Retain shared schema and audit data.
  }
}
