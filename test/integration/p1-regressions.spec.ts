import { ReputationLevel } from "../../src/modules/reviews/reputation-level";
jest.mock("@nestjs/schedule", () => ({ Cron: () => () => {} }));
import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { ConfigService } from "@nestjs/config";
import {
  createTestDataSource,
  initializeTestDatabase,
  disposeTestDatabase,
  ownedTestSchema,
} from "./database";
import { createTestUser, createTestCategory, createTestPost } from "./fixtures";
import { AuthorizationService } from "../../src/modules/authorization/authorization.service";
import { CaslAbilityFactory } from "../../src/modules/authorization/casl-ability.factory";
import { PostEntity, PostStatus } from "../../src/modules/posts/post.entity";
import { CategoryEntity } from "../../src/modules/categories/category.entity";
import { UserEntity } from "../../src/modules/user/user.entity";
import { ReviewEntity } from "../../src/modules/reviews/review.entity";
import { ReviewsService } from "../../src/modules/reviews/reviews.service";
import { sellerStatistics } from "../../src/modules/reviews/seller-statistics";
import { PostsService } from "../../src/modules/posts/posts.service";
import { FindPostsDto } from "../../src/modules/posts/dto/find-posts.dto";
import { SearchPostsDto } from "../../src/modules/posts/dto/search-posts.dto";
import { PaymentsService } from "../../src/modules/payments/payments.service";
import { sign } from "../../src/modules/payments/vnpay";
import {
  NotificationEntity,
  NotificationType,
} from "../../src/modules/notifications/notification.entity";
import { NotificationsService } from "../../src/modules/notifications/notifications.service";
import { StorageService } from "../../src/modules/storage/storage.service";
import { Promotion } from "../../src/modules/promotions/promotion.entity";
import { PaymentsPromotions1791810000000 } from "../../src/database/migrations/1791810000000-PaymentsPromotions";
import { PostLifecycle1791810000000 } from "../../src/database/migrations/1791810000000-PostLifecycle";
import { PostExpiryAndPromotions1791830000000 } from "../../src/database/migrations/1791830000000-PostExpiryAndPromotions";
import { UnifyPostPromotions1791840000000 } from "../../src/database/migrations/1791840000000-UnifyPostPromotions";
const auth = new AuthorizationService(new CaslAbilityFactory());
const context = (user: UserEntity) =>
  auth.createAuthenticatedContext({
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    isAdmin: user.isAdmin,
    hasLocation: true,
  });
const payments = (ds: DataSource) =>
  new PaymentsService(
    ds,
    new ConfigService({
      VNPAY_TMN_CODE: "TESTCODE",
      VNPAY_HASH_SECRET: "regression-secret",
      VNPAY_PAYMENT_URL: "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html",
      VNPAY_API_URL:
        "https://sandbox.vnpayment.vn/merchant_webapi/api/transaction",
      VNPAY_RETURN_URL: "http://localhost:3000/payments/vnpay/return",
    }),
  );

describe("P1 trust and payment lock regressions", () => {
  let ds: DataSource;
  beforeAll(async () => {
    ds = createTestDataSource();
    await initializeTestDatabase(ds);
  });
  afterAll(async () => {
    if (ds) await disposeTestDatabase(ds);
  });
  it("seller deletion cannot erase verified reputation from profile, feed, search or filters", async () => {
    const seller = await createTestUser(ds),
      buyer = await createTestUser(ds),
      category = await createTestCategory(ds);
    const service = new PostsService(
      ds.getRepository(PostEntity),
      ds.getRepository(CategoryEntity),
      auth,
      ds,
      {} as StorageService,
    );
    const reviews = new ReviewsService(
      ds.getRepository(ReviewEntity),
      ds.getRepository(PostEntity),
      ds.getRepository(UserEntity),
      auth,
    );
    const sold: PostEntity[] = [];
    const saved: ReviewEntity[] = [];
    for (let i = 0; i < 3; i++) {
      const p = await createTestPost(ds, seller.id, category.id, {
        status: PostStatus.SOLD,
        buyerId: buyer.id,
        soldAt: new Date(),
      });
      sold.push(p);
      saved.push(
        await reviews.create({ postId: p.id, rating: 1 }, context(buyer)),
      );
    }
    const live = await createTestPost(ds, seller.id, category.id);
    const before = await sellerStatistics(ds, seller.id);
    for (const p of sold) await service.remove(p.id, context(seller));
    expect(await sellerStatistics(ds, seller.id)).toMatchObject({
      ratingAverage: before.ratingAverage,
      reviewCount: 3,
      reputationLevel: "LOW",
    });
    const guest = auth.createGuestContext();
    expect(
      (await reviews.findBySeller(seller.id, { page: 1, limit: 20 }, guest))
        .meta.total,
    ).toBe(3);
    expect(
      (
        await service.findAll(
          Object.assign(new FindPostsDto(), {
            categoryId: category.id,
            reputationLevel: ReputationLevel.LOW,
          }),
          guest,
        )
      ).items.map((p) => p.id),
    ).toEqual([live.id]);
    for (const result of [
      await service.findAll(
        Object.assign(new FindPostsDto(), { categoryId: category.id }),
        guest,
      ),
      await service.search(
        Object.assign(new SearchPostsDto(), { categoryId: category.id }),
        guest,
      ),
    ]) {
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe(live.id);
      expect(result.items[0].seller).toMatchObject({
        reputationLevel: "LOW",
        reviewCount: 3,
        ratingAverage: 1,
      });
    }
    // Moderating/deleting the review itself still excludes that review.
    await reviews.remove(saved[0].id, context(buyer));
    expect(await sellerStatistics(ds, seller.id)).toMatchObject({
      reviewCount: 2,
    });
  });
  it("checkout and confirmation allow expiry notifications while waiting for the same post", async () => {
    const seller = await createTestUser(ds),
      category = await createTestCategory(ds),
      post = await createTestPost(ds, seller.id, category.id);
    const service = payments(ds),
      schema = ownedTestSchema(ds);
    const notify = new NotificationsService(
      ds.getRepository(NotificationEntity),
      ds,
      {} as never,
      {} as never,
      auth,
    );
    const withExpiryLock = async <T>(work: () => Promise<T>): Promise<T> => {
      const q = ds.createQueryRunner();
      await q.connect();
      await q.startTransaction();
      let operation: Promise<{ value: T } | { error: unknown }> | undefined;
      try {
        await q.query("SET LOCAL lock_timeout = '1500ms'");
        await q.manager
          .getRepository(PostEntity)
          .createQueryBuilder("post")
          .where("post.id=:id", { id: post.id })
          .setLock("pessimistic_write")
          .getOneOrFail();
        operation = work().then(
          (value) => ({ value }),
          (error) => ({ error }),
        );
        const deadline = Date.now() + 10000;
        let waiting = false;
        while (Date.now() < deadline) {
          const rows = await ds.query(
            "SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE $1",
            [`%FROM "${schema}"."posts"%FOR UPDATE%`],
          );
          if (rows.length) {
            waiting = true;
            break;
          }
        }
        expect(waiting).toBe(true);
        expect(
          await notify.createOnce(q.manager, {
            userId: seller.id,
            type: NotificationType.POST_EXPIRING,
            refId: post.id,
            targetType: "my_post",
            dedupKey: randomUUID(),
            title: "Expiry regression",
            body: "Fixture",
          }),
        ).not.toBeNull();
        await q.commitTransaction();
        const result = await operation;
        if ("error" in result) throw result.error;
        return result.value;
      } finally {
        if (q.isTransactionActive) await q.rollbackTransaction();
        await q.release();
        if (operation) await operation;
      }
    };
    const order = await withExpiryLock(() =>
      service.create(
        seller.id,
        post.id,
        "boost_24h",
        randomUUID(),
        "127.0.0.1",
      ),
    );
    const event: Record<string, string> = {
      vnp_TmnCode: "TESTCODE",
      vnp_TxnRef: order.txnRef,
      vnp_Amount: "1000000",
      vnp_ResponseCode: "00",
      vnp_TransactionStatus: "00",
      vnp_TransactionNo: "11113333",
    };
    event.vnp_SecureHash = sign(event, "regression-secret");
    expect(await withExpiryLock(() => service.ipn(event))).toEqual({
      RspCode: "00",
      Message: "Confirm Success",
    });
    expect(
      await ds.getRepository(Promotion).countBy({ orderId: order.id }),
    ).toBe(1);
    expect(
      await ds.getRepository(NotificationEntity).countBy({ refId: post.id }),
    ).toBe(2);
  });
});

describe.each(["payments-first", "lifecycle-first"])(
  "migration from the original admin branch (%s)",
  (order) => {
    it("runs pending history in one transaction, preserving deadlines and campaign audit", async () => {
      const ds = createTestDataSource();
      try {
        await initializeTestDatabase(ds);
        const seller = await createTestUser(ds),
          admin = await createTestUser(ds, { isAdmin: true }),
          category = await createTestCategory(ds);
        const deadline = new Date(Date.now() - 86400000);
        const existing = await createTestPost(ds, seller.id, category.id, {
          publishedAt: new Date(deadline.getTime() - 14 * 86400000),
          expiresAt: deadline,
        });
        const futureDeadline = new Date(Date.now() + 30 * 86400000);
        const future = await createTestPost(ds, seller.id, category.id, {
          expiresAt: futureDeadline,
        });
        const legacy = await createTestPost(ds, seller.id, category.id);
        const q = ds.createQueryRunner();
        await q.connect();
        const promotionId = randomUUID(),
          cancelledAt = new Date(Date.now() - 1000),
          startsAt = new Date(Date.now() - 3600000),
          endsAt = new Date(Date.now() + 3600000);
        try {
          await new PaymentsPromotions1791810000000().down(q);
          await q.query("DROP TABLE post_renewals");
          await q.query(
            "ALTER TABLE posts DROP CONSTRAINT chk_posts_lifetime, DROP COLUMN published_at, DROP COLUMN renewal_count, ALTER COLUMN expires_at DROP NOT NULL",
          );
          await q.query(
            "ALTER TABLE notifications DROP COLUMN target_type, DROP COLUMN dedup_key",
          );
          await q.query("UPDATE posts SET expires_at=NULL WHERE id=$1", [
            legacy.id,
          ]);
          await q.query(
            'CREATE TABLE post_promotions(id uuid PRIMARY KEY,post_id uuid NOT NULL REFERENCES posts(id),starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL,created_by_id uuid NOT NULL REFERENCES "user"(id),cancelled_at timestamptz,cancelled_by_id uuid REFERENCES "user"(id),created_at timestamptz NOT NULL DEFAULT now())',
          );
          await q.query(
            "INSERT INTO post_promotions(id,post_id,starts_at,ends_at,created_by_id,cancelled_at,cancelled_by_id) VALUES($1,$2,$3,$4,$5,$6,$5)",
            [promotionId, existing.id, startsAt, endsAt, admin.id, cancelledAt],
          );
          await q.query(
            "CREATE TABLE migrations(id serial PRIMARY KEY,timestamp bigint NOT NULL,name varchar NOT NULL)",
          );
          await q.query(
            "INSERT INTO migrations(timestamp,name) VALUES($1,$2)",
            [1791830000000, "PostExpiryAndPromotions1791830000000"],
          );
        } finally {
          await q.release();
        }
        const prior =
          order === "payments-first"
            ? [
                new PaymentsPromotions1791810000000(),
                new PostLifecycle1791810000000(),
              ]
            : [
                new PostLifecycle1791810000000(),
                new PaymentsPromotions1791810000000(),
              ];
        ds.migrations.splice(
          0,
          ds.migrations.length,
          ...prior,
          new PostExpiryAndPromotions1791830000000(),
          new UnifyPostPromotions1791840000000(),
        );
        const applied = await ds.runMigrations({ transaction: "all" });
        expect(applied).toHaveLength(3);
        const preserved = await ds
          .getRepository(PostEntity)
          .findOneByOrFail({ id: existing.id });
        expect(preserved.expiresAt).toEqual(deadline);
        expect(preserved.createdAt).toEqual(existing.createdAt);
        expect(preserved.publishedAt.getTime()).toBeLessThan(
          preserved.expiresAt.getTime(),
        );
        expect(
          (
            await ds
              .getRepository(PostEntity)
              .findOneByOrFail({ id: future.id })
          ).expiresAt,
        ).toEqual(futureDeadline);
        const backfilled = await ds
          .getRepository(PostEntity)
          .findOneByOrFail({ id: legacy.id });
        expect(
          backfilled.expiresAt.getTime() - backfilled.publishedAt.getTime(),
        ).toBe(14 * 86400000);
        expect(
          await ds
            .getRepository(Promotion)
            .findOneByOrFail({ id: promotionId }),
        ).toMatchObject({
          orderId: null,
          createdById: admin.id,
          cancelledById: admin.id,
          cancelledAt,
          startsAt,
          endsAt,
        });
        const rollback = ds.createQueryRunner();
        await rollback.connect();
        try {
          for (const migration of [
            new PostLifecycle1791810000000(),
            new PaymentsPromotions1791810000000(),
          ])
            await expect(migration.down(rollback)).rejects.toThrow(
              "adopted an existing branch schema",
            );
          expect(
            await ds.getRepository(Promotion).countBy({ id: promotionId }),
          ).toBe(1);
          expect(
            (
              await ds
                .getRepository(PostEntity)
                .findOneByOrFail({ id: existing.id })
            ).expiresAt,
          ).toEqual(deadline);
        } finally {
          await rollback.release();
        }
        expect(await ds.runMigrations({ transaction: "all" })).toHaveLength(0);
      } finally {
        await disposeTestDatabase(ds);
      }
    });
  },
);
