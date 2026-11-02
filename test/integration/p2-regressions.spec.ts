jest.mock("@nestjs/schedule", () => ({ Cron: () => () => {} }));
import { randomUUID } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import { DataSource } from "typeorm";
import { AuthorizationService } from "../../src/modules/authorization/authorization.service";
import { CaslAbilityFactory } from "../../src/modules/authorization/casl-ability.factory";
import { AccountLifecycleService } from "../../src/common/account-lifecycle/account-lifecycle.service";
import { PostEntity, PostStatus } from "../../src/modules/posts/post.entity";
import { CategoryEntity } from "../../src/modules/categories/category.entity";
import { PostsService } from "../../src/modules/posts/posts.service";
import { PostPromotionsService } from "../../src/modules/posts/post-promotions.service";
import { FindPostsDto } from "../../src/modules/posts/dto/find-posts.dto";
import { SearchPostsDto } from "../../src/modules/posts/dto/search-posts.dto";
import { PostLifecycleService } from "../../src/modules/posts/post-lifecycle.service";
import { PostActivationPolicyService } from "../../src/modules/posts/post-activation-policy.service";
import { ModerationPostingPolicy } from "../../src/modules/posts/moderation-posting-policy";
import { ModerationService } from "../../src/modules/moderation/moderation.service";
import { UserWarningEntity } from "../../src/modules/moderation/user-warning.entity";
import { PostingRestrictionType } from "../../src/modules/moderation/posting-restriction.rules";
import { ReputationWarningScheduler } from "../../src/modules/moderation/reputation-warning.scheduler";
import { PaymentsService } from "../../src/modules/payments/payments.service";
import { PaymentOrder } from "../../src/modules/payments/payment.entity";
import { sign } from "../../src/modules/payments/vnpay";
import { Promotion } from "../../src/modules/promotions/promotion.entity";
import { ReviewEntity } from "../../src/modules/reviews/review.entity";
import { ReviewsService } from "../../src/modules/reviews/reviews.service";
import { UserEntity } from "../../src/modules/user/user.entity";
import { NotificationsService } from "../../src/modules/notifications/notifications.service";
import { NotificationEntity } from "../../src/modules/notifications/notification.entity";
import { ModerationWarningsAndCancelledBoosts1791850000000 } from "../../src/database/migrations/1791850000000-ModerationWarningsAndCancelledBoosts";
import {
  createTestDataSource,
  initializeTestDatabase,
  disposeTestDatabase,
  ownedTestSchema,
} from "./database";
import { createTestUser, createTestCategory, createTestPost } from "./fixtures";

describe("remaining backend regressions", () => {
  let ds: DataSource;
  const auth = new AuthorizationService(new CaslAbilityFactory());
  const context = (user: UserEntity) =>
    auth.createAuthenticatedContext({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      isAdmin: user.isAdmin,
      hasLocation: true,
    });
  let seller: UserEntity,
    buyer: UserEntity,
    admin: UserEntity,
    category: CategoryEntity;
  let payments: PaymentsService,
    promotions: PostPromotionsService,
    moderation: ModerationService,
    posts: PostsService,
    notifications: NotificationsService;
  const event = (ref: string) => {
    const payload = {
      vnp_TmnCode: "TESTCODE",
      vnp_TxnRef: ref,
      vnp_Amount: "1000000",
      vnp_ResponseCode: "00",
      vnp_TransactionStatus: "00",
      vnp_TransactionNo: String(Date.now()) + Math.floor(Math.random() * 10000),
    };
    return { ...payload, vnp_SecureHash: sign(payload, "test-secret") };
  };
  beforeAll(async () => {
    ds = createTestDataSource();
    await initializeTestDatabase(ds);
    payments = new PaymentsService(
      ds,
      new ConfigService({
        VNPAY_TMN_CODE: "TESTCODE",
        VNPAY_HASH_SECRET: "test-secret",
        VNPAY_PAYMENT_URL: "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html",
        VNPAY_RETURN_URL: "http://localhost:3000/payments/vnpay/return",
      }),
    );
    notifications = new NotificationsService(
      ds.getRepository(NotificationEntity),
      ds,
      {} as never,
      { emitToUser: jest.fn() } as never,
      auth,
    );
    moderation = new ModerationService(ds, auth, notifications);
    promotions = new PostPromotionsService(
      ds.getRepository(Promotion),
      ds.getRepository(PostEntity),
      auth,
    );
    posts = new PostsService(
      ds.getRepository(PostEntity),
      ds.getRepository(CategoryEntity),
      auth,
      ds,
      {} as never,
      moderation,
    );
  });
  beforeEach(async () => {
    seller = await createTestUser(ds);
    buyer = await createTestUser(ds);
    admin = await createTestUser(ds, { isAdmin: true });
    category = await createTestCategory(ds);
  });
  afterAll(async () => {
    if (ds) await disposeTestDatabase(ds);
  });
  const post = (extra: Partial<PostEntity> = {}) =>
    createTestPost(ds, seller.id, category.id, extra);
  const purchase = async (postId: string) => {
    const order = await payments.create(
      seller.id,
      postId,
      "boost_24h",
      randomUUID(),
      "127.0.0.1",
    );
    expect((await payments.ipn(event(order.txnRef))).RspCode).toBe("00");
    return order;
  };
  it("hides locked/deleted sellers from feed, search and public detail without destroying paid boosts", async () => {
    const listing = await post();
    await purchase(listing.id);
    const other = await createTestUser(ds);
    const visible = await createTestPost(ds, other.id, category.id);
    const lifecycle = new AccountLifecycleService(ds, auth, {
      invalidateUser: jest.fn(),
    } as never);
    await lifecycle.lockAccount(context(admin), seller.id);
    for (const result of [
      await posts.findAll(
        Object.assign(new FindPostsDto(), {
          categoryId: category.id,
          limit: 1,
        }),
        auth.createGuestContext(),
      ),
      await posts.search(
        Object.assign(new SearchPostsDto(), {
          categoryId: category.id,
          limit: 1,
        }),
        auth.createGuestContext(),
      ),
    ]) {
      expect(result.meta.total).toBe(1);
      expect(result.items.map((p) => p.id)).toEqual([visible.id]);
    }
    await expect(
      posts.findOne(listing.id, auth.createGuestContext()),
    ).rejects.toMatchObject({ status: 404 });
    await expect(posts.getActivePost(listing.id)).rejects.toMatchObject({
      status: 404,
    });
    expect(
      await ds.getRepository(Promotion).countBy({ postId: listing.id }),
    ).toBe(1);
    await lifecycle.unlockAccount(context(admin), seller.id);
    expect(
      (
        await posts.findAll(
          Object.assign(new FindPostsDto(), { categoryId: category.id }),
          auth.createGuestContext(),
        )
      ).meta.total,
    ).toBe(2);
    await ds.getRepository(UserEntity).softDelete(seller.id);
    expect(
      (
        await posts.findAll(
          Object.assign(new FindPostsDto(), { categoryId: category.id }),
          auth.createGuestContext(),
        )
      ).meta.total,
    ).toBe(1);
  });
  it("cancels paid boost once, retains winning audit and marks paid order for review atomically", async () => {
    const listing = await post(),
      order = await purchase(listing.id);
    const promotion = await ds
      .getRepository(Promotion)
      .findOneByOrFail({ orderId: order.id });
    const otherAdmin = await createTestUser(ds, { isAdmin: true });
    const attempts = await Promise.allSettled(
      [admin, otherAdmin].map((actor) =>
        promotions.adminCancel(context(actor), listing.id, promotion.id),
      ),
    );
    expect(attempts.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(attempts.find((r) => r.status === "rejected")).toMatchObject({
      reason: { status: 409 },
    });
    const winner = attempts.find(
      (r) => r.status === "fulfilled",
    ) as PromiseFulfilledResult<{ cancelledById: string | null }>;
    expect(
      await ds.getRepository(Promotion).findOneByOrFail({ id: promotion.id }),
    ).toMatchObject({ cancelledById: winner.value.cancelledById });
    expect(await payments.read(seller.id, order.id)).toMatchObject({
      status: "paid",
      fulfillment: "requires_review",
      reason: "promotion_cancelled_by_admin",
    });
    expect((await payments.ipn(event(order.txnRef))).RspCode).toBe("02");
    expect((await payments.read(seller.id, order.id)).fulfillment).toBe(
      "requires_review",
    );
  });
  it("rolls back cancellation and audit if the order update fails", async () => {
    const listing = await post(),
      order = await purchase(listing.id),
      schema = ownedTestSchema(ds);
    const promotion = await ds
      .getRepository(Promotion)
      .findOneByOrFail({ orderId: order.id });
    await ds.query(
      `ALTER TABLE "${schema}".payment_orders ADD CONSTRAINT test_no_review CHECK (fulfillment <> 'requires_review') NOT VALID`,
    );
    try {
      await expect(
        promotions.adminCancel(context(admin), listing.id, promotion.id),
      ).rejects.toBeDefined();
      expect(
        (
          await ds
            .getRepository(Promotion)
            .findOneByOrFail({ id: promotion.id })
        ).cancelledAt,
      ).toBeNull();
      expect((await payments.read(seller.id, order.id)).fulfillment).toBe(
        "active",
      );
    } finally {
      await ds.query(
        `ALTER TABLE "${schema}".payment_orders DROP CONSTRAINT test_no_review`,
      );
    }
  });
  it("rejects scheduled overlap for selected duration and records late paid conflicts for review", async () => {
    const listing = await post();
    const schedule = {
      startsAt: new Date(Date.now() + 30 * 3600000).toISOString(),
      endsAt: new Date(Date.now() + 35 * 3600000).toISOString(),
    };
    await promotions.adminCreate(context(admin), listing.id, schedule);
    await expect(
      payments.create(
        seller.id,
        listing.id,
        "boost_48h",
        randomUUID(),
        "127.0.0.1",
      ),
    ).rejects.toMatchObject({ status: 409 });
    const order = await payments.create(
      seller.id,
      listing.id,
      "boost_24h",
      randomUUID(),
      "127.0.0.1",
    );
    await promotions.adminCreate(context(admin), listing.id, {
      startsAt: new Date(Date.now() + 6 * 3600000).toISOString(),
      endsAt: new Date(Date.now() + 12 * 3600000).toISOString(),
    });
    expect((await payments.ipn(event(order.txnRef))).RspCode).toBe("00");
    expect(await payments.read(seller.id, order.id)).toMatchObject({
      status: "paid",
      fulfillment: "requires_review",
      reason: "scheduled_promotion_overlap",
    });
    expect(
      await ds.getRepository(Promotion).countBy({ orderId: order.id }),
    ).toBe(0);
  });
  it("persists a user-visible admin warning and notification together with private self history", async () => {
    const warning = await moderation.issueWarning(context(admin), {
      userId: seller.id,
      reason: "Vi phạm mô tả tin",
    });
    expect(
      await ds
        .getRepository(NotificationEntity)
        .findOneByOrFail({ dedupKey: `moderation-warning:${warning.id}` }),
    ).toMatchObject({
      userId: seller.id,
      targetType: "posting_status",
      refId: seller.id,
      body: "Vi phạm mô tả tin",
    });
    expect(
      (await moderation.listMyWarnings(context(buyer), { page: 1, limit: 10 }))
        .items,
    ).toEqual([]);
    const history = await moderation.listMyWarnings(context(seller), {
      page: 1,
      limit: 10,
    });
    expect(history.items).toEqual([
      {
        id: warning.id,
        reason: warning.reason,
        createdAt: warning.createdAt.toISOString(),
      },
    ]);
  });
  it("blocks all activation paths from live reputation, recovers immediately and retains manual bans", async () => {
    const reviews = new ReviewsService(
      ds.getRepository(ReviewEntity),
      ds.getRepository(PostEntity),
      ds.getRepository(UserEntity),
      auth,
    );
    const carriers: PostEntity[] = [];
    for (let i = 0; i < 3; i++) {
      const carrier = await post({
        status: PostStatus.SOLD,
        buyerId: buyer.id,
        soldAt: new Date(),
      });
      carriers.push(carrier);
      await reviews.create({ postId: carrier.id, rating: 1 }, context(buyer));
    }
    const activation = new PostLifecycleService(
      ds,
      auth,
      new PostActivationPolicyService(new ModerationPostingPolicy(moderation)),
    );
    expect(await activation.quota(context(seller))).toMatchObject({
      postingAllowed: false,
    });
    expect(await moderation.isPostingRestricted(seller.id)).toBe(true);
    await expect(
      moderation.assertCanPost(ds.manager, seller.id, new Date()),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      await moderation.getMyPostingRestrictionStatus(context(seller)),
    ).toMatchObject({
      canCreatePost: false,
      reputation: { warning: true, blocked: true },
    });
    const expired = await post({
      status: PostStatus.EXPIRED,
      publishedAt: new Date(Date.now() - 15 * 86400000),
      expiresAt: new Date(Date.now() - 86400000),
    });
    const deleted = await post();
    await ds.getRepository(PostEntity).softDelete(deleted.id);
    const dto = {
      title: "Test",
      description: "Test",
      price: "10000",
      categoryId: category.id,
      condition: carriers[0].condition,
    };
    await expect(activation.create(dto, context(seller))).rejects.toMatchObject(
      { status: 403 },
    );
    await expect(
      activation.renewFree(expired.id, context(seller)),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      activation.restore(deleted.id, context(seller)),
    ).rejects.toMatchObject({ status: 403 });
    const scheduler = new ReputationWarningScheduler(ds, notifications);
    await Promise.all([
      scheduler.run(),
      new ReputationWarningScheduler(ds, notifications).run(),
    ]);
    await scheduler.run();
    expect(
      await ds
        .getRepository(NotificationEntity)
        .countBy({ dedupKey: `reputation-warning:${seller.id}` }),
    ).toBe(1);
    const review = await ds
      .getRepository(ReviewEntity)
      .findOneByOrFail({ postId: carriers[0].id });
    await reviews.update(review.id, { rating: 3 }, context(buyer));
    expect(
      await moderation.getMyPostingRestrictionStatus(context(seller)),
    ).toMatchObject({
      canCreatePost: true,
      reputation: { warning: true, blocked: false },
    });
    await reviews.update(review.id, { rating: 5 }, context(buyer));
    expect(await moderation.isPostingRestricted(seller.id)).toBe(false);
    expect(await activation.quota(context(seller))).toMatchObject({
      postingAllowed: true,
    });
    await activation.renewFree(expired.id, context(seller));
    await activation.restore(deleted.id, context(seller));
    await activation.create(dto, context(seller));
    await moderation.createPostingRestriction(context(admin), {
      userId: seller.id,
      type: PostingRestrictionType.PERMANENT,
      reason: "Manual ban",
    });
    expect(await activation.quota(context(seller))).toMatchObject({
      postingAllowed: false,
      reason: "Manual ban",
    });
  });
  it("does not save an admin warning if notification persistence fails", async () => {
    const schema = ownedTestSchema(ds);
    await ds.query(
      `ALTER TABLE "${schema}".notifications ADD CONSTRAINT test_warning_failure CHECK (title <> 'Cảnh báo từ quản trị viên') NOT VALID`,
    );
    try {
      await expect(
        moderation.issueWarning(context(admin), {
          userId: seller.id,
          reason: "Must roll back",
        }),
      ).rejects.toBeDefined();
      expect(
        await ds
          .getRepository(UserWarningEntity)
          .countBy({ userId: seller.id }),
      ).toBe(0);
      expect(
        await ds
          .getRepository(NotificationEntity)
          .countBy({ userId: seller.id }),
      ).toBe(0);
    } finally {
      await ds.query(
        `ALTER TABLE "${schema}".notifications DROP CONSTRAINT test_warning_failure`,
      );
    }
  });
  it("backfills old cancelled paid orders without inventing refunds and is repeatable", async () => {
    const listing = await post(),
      order = await purchase(listing.id);
    await ds
      .getRepository(Promotion)
      .update(
        { orderId: order.id },
        { cancelledAt: new Date(), cancelledById: admin.id },
      );
    const runner = ds.createQueryRunner();
    await runner.connect();
    try {
      const migration = new ModerationWarningsAndCancelledBoosts1791850000000();
      await migration.up(runner);
      await migration.up(runner);
    } finally {
      await runner.release();
    }
    expect(await payments.read(seller.id, order.id)).toMatchObject({
      status: "paid",
      fulfillment: "requires_review",
      reason: "promotion_cancelled_by_admin",
    });
  });
});
