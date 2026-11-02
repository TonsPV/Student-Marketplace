import { randomUUID } from "crypto";
import { DataSource } from "typeorm";
import {
  createTestDataSource,
  initializeTestDatabase,
  disposeTestDatabase,
  ownedTestSchema,
} from "./database";
import { createTestUser, createTestCategory, createTestPost } from "./fixtures";
import { PaymentsPromotions1791810000000 } from "../../src/database/migrations/1791810000000-PaymentsPromotions";
import { PostExpiryAndPromotions1791830000000 } from "../../src/database/migrations/1791830000000-PostExpiryAndPromotions";
import { UnifyPostPromotions1791840000000 } from "../../src/database/migrations/1791840000000-UnifyPostPromotions";
import { Promotion } from "../../src/modules/promotions/promotion.entity";
import { PostPromotionEntity } from "../../src/modules/posts/post-promotion.entity";
import { PostEntity } from "../../src/modules/posts/post.entity";
import { PostPromotionsService } from "../../src/modules/posts/post-promotions.service";
import { AuthorizationService } from "../../src/modules/authorization/authorization.service";
import { CaslAbilityFactory } from "../../src/modules/authorization/casl-ability.factory";

describe("promotion schema merge preserves lifecycle and paid history", () => {
  let ds: DataSource;
  beforeAll(async () => {
    ds = createTestDataSource();
    await initializeTestDatabase(ds);
  });
  afterAll(async () => {
    if (ds) await disposeTestDatabase(ds);
  });
  it("upgrades the real paid schema, preserves data, supports admin campaigns, and is idempotent", async () => {
    const q = ds.createQueryRunner();
    await q.connect();
    try {
      const schema = ownedTestSchema(ds);
      // The runner's connection explicitly targets the test schema, never public.
      const [path] = await q.query("SELECT current_schema() AS schema");
      expect(path.schema).toBe(schema);
      await new PaymentsPromotions1791810000000().down(q);
      await new PaymentsPromotions1791810000000().up(q);
      const seller = await createTestUser(ds),
        category = await createTestCategory(ds);
      const post = await createTestPost(ds, seller.id, category.id);
      const orderId = randomUUID(),
        promotionId = randomUUID();
      await q.query(
        `INSERT INTO payment_orders(id,"ownerId","postId","packageCode",amount,hours,"txnRef","idempotencyKey",status,fulfillment,"paymentUrl","expiresAt") VALUES($1,$2,$3,'boost_24h',10000,24,$4,$4,'paid','active','https://sandbox.example.test',now()+interval '15 minutes')`,
        [orderId, seller.id, post.id, randomUUID()],
      );
      await q.query(
        `INSERT INTO post_promotions(id,"postId","orderId","startsAt","endsAt") VALUES($1,$2,$3,now(),now()+interval '24 hours')`,
        [promotionId, post.id, orderId],
      );
      const before = await q.query(
        'SELECT id,"postId","orderId","startsAt","endsAt" FROM post_promotions',
      );
      const money = await q.query("SELECT * FROM payment_orders");
      await q.startTransaction();
      await new PostExpiryAndPromotions1791830000000().up(q);
      await new UnifyPostPromotions1791840000000().up(q);
      await q.commitTransaction();
      expect(
        await q.query(
          'SELECT id,"postId","orderId","startsAt","endsAt" FROM post_promotions',
        ),
      ).toEqual(before);
      expect(await q.query("SELECT * FROM payment_orders")).toEqual(money);
      const reloaded = await ds
        .getRepository(PostEntity)
        .findOneByOrFail({ id: post.id });
      expect(reloaded.expiresAt).toEqual(post.expiresAt);
      expect(reloaded.publishedAt).toEqual(post.publishedAt);
      expect(reloaded.renewalCount).toBe(post.renewalCount);
      expect(PostPromotionEntity).toBe(Promotion);
      const paid = await ds
        .getRepository(PostPromotionEntity)
        .findOneByOrFail({ id: promotionId });
      expect(paid).toMatchObject({
        orderId,
        createdById: seller.id,
        cancelledAt: null,
        cancelledById: null,
      });
      await expect(
        ds.getRepository(Promotion).save(
          ds.getRepository(Promotion).create({
            postId: post.id,
            orderId,
            startsAt: new Date(),
            endsAt: new Date(Date.now() + 86400000),
          }),
        ),
      ).rejects.toMatchObject({ driverError: { code: "23505" } });
      const admin = await createTestUser(ds, { isAdmin: true });
      const authorization = new AuthorizationService(new CaslAbilityFactory());
      const context = authorization.createAuthenticatedContext({
        id: admin.id,
        email: admin.email,
        fullName: admin.fullName,
        isAdmin: true,
        hasLocation: true,
      });
      const service = new PostPromotionsService(
        ds.getRepository(Promotion),
        ds.getRepository(PostEntity),
        authorization,
      );
      await expect(
        service.adminCreate(context, post.id, {
          endsAt: new Date(Date.now() + 3600000).toISOString(),
        }),
      ).rejects.toMatchObject({ status: 409 });
      const fresh = await createTestPost(ds, seller.id, category.id);
      const attempts = await Promise.allSettled(
        [1, 2].map(() =>
          service.adminCreate(context, fresh.id, {
            endsAt: new Date(Date.now() + 3600000).toISOString(),
          }),
        ),
      );
      expect(attempts.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(attempts.filter((r) => r.status === "rejected")).toHaveLength(1);
      expect(
        await ds.getRepository(Promotion).countBy({ postId: fresh.id }),
      ).toBe(1);
      expect(
        (
          await ds
            .getRepository(Promotion)
            .findOneByOrFail({ postId: fresh.id })
        ).orderId,
      ).toBeNull();
    } finally {
      if (q.isTransactionActive) await q.rollbackTransaction();
      await q.release();
    }
  });
  it("converges the alternate snake-case campaign schema without losing audit data", async () => {
    const q = ds.createQueryRunner();
    await q.connect();
    try {
      const snapshot = await q.query(
        "SELECT * FROM post_promotions ORDER BY id",
      );
      for (const [from, to] of [
        ["postId", "post_id"],
        ["startsAt", "starts_at"],
        ["endsAt", "ends_at"],
      ])
        await q.query(
          `ALTER TABLE post_promotions RENAME COLUMN "${from}" TO "${to}"`,
        );
      await new UnifyPostPromotions1791840000000().up(q);
      expect(
        await q.query("SELECT * FROM post_promotions ORDER BY id"),
      ).toEqual(snapshot);
      await new PostExpiryAndPromotions1791830000000().down(q);
      expect(
        await q.query("SELECT * FROM post_promotions ORDER BY id"),
      ).toEqual(snapshot);
    } finally {
      await q.release();
    }
  });
});
