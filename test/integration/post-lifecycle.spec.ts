import "reflect-metadata";
import { DataSource } from "typeorm";
import { AuthorizationService } from "../../src/modules/authorization/authorization.service";
import { CaslAbilityFactory } from "../../src/modules/authorization/casl-ability.factory";
import { CategoryEntity } from "../../src/modules/categories/category.entity";
import { ConversationsService } from "../../src/modules/conversations/conversations.service";
import { FavoritesService } from "../../src/modules/favorites/favorites.service";
import { FavoriteEntity } from "../../src/modules/favorites/favorite.entity";
import {
  NotificationEntity,
  NotificationType,
} from "../../src/modules/notifications/notification.entity";
import { NotificationsService } from "../../src/modules/notifications/notifications.service";
import {
  PostActivationPolicyService,
  PostingDecision,
} from "../../src/modules/posts/post-activation-policy.service";
import { PostExpiryService } from "../../src/modules/posts/post-expiry.service";
import { PostLifecycleService } from "../../src/modules/posts/post-lifecycle.service";
import { DAY_MS } from "../../src/modules/posts/post-lifecycle.constants";
import {
  PostEntity,
  PostStatus,
  PostCondition,
} from "../../src/modules/posts/post.entity";
import { PostRenewalEntity } from "../../src/modules/posts/post-renewal.entity";
import { PostsService } from "../../src/modules/posts/posts.service";
import { RealtimeService } from "../../src/modules/realtime/realtime.service";
import { StorageService } from "../../src/modules/storage/storage.service";
import { PublicUserService } from "../../src/modules/user/public-user.service";
import { UserEntity } from "../../src/modules/user/user.entity";
import {
  createTestDataSource,
  initializeTestDatabase,
  disposeTestDatabase,
} from "./database";
import {
  createReadyTestUser,
  createTestCategory,
  createTestPost,
  cleanFixtures,
} from "./fixtures";

describe("post quota, expiry and renewal (PostgreSQL)", () => {
  let ds: DataSource, seller: UserEntity, category: CategoryEntity;
  let lifecycle: PostLifecycleService,
    posts: PostsService,
    expiry: PostExpiryService;
  let notifications: NotificationsService;
  let decision: PostingDecision;
  const realtime = { emitToUser: jest.fn() };
  const authorization = new AuthorizationService(new CaslAbilityFactory());
  const context = () =>
    authorization.createAuthenticatedContext({ ...seller, hasLocation: true });
  const dto = () => ({
    categoryId: category.id,
    title: "Student book",
    description: "A textbook in good condition for students",
    price: "50000",
    condition: PostCondition.GOOD,
  });
  const oldDates = () => ({
    publishedAt: new Date(Date.now() - 15 * DAY_MS),
    expiresAt: new Date(Date.now() - DAY_MS),
  });
  const seed = (overrides: Partial<PostEntity> = {}) =>
    createTestPost(ds, seller.id, category.id, overrides);

  beforeAll(async () => {
    ds = createTestDataSource();
    await initializeTestDatabase(ds);
  });
  afterAll(async () => {
    if (ds) await disposeTestDatabase(ds);
  });
  beforeEach(async () => {
    await cleanFixtures(ds);
    seller = await createReadyTestUser(ds);
    category = await createTestCategory(ds);
    decision = { allowed: true, limit: 5, reason: null, blockedUntil: null };
    lifecycle = new PostLifecycleService(
      ds,
      authorization,
      new PostActivationPolicyService({ evaluate: async () => decision }),
    );
    posts = new PostsService(
      ds.getRepository(PostEntity),
      ds.getRepository(CategoryEntity),
      authorization,
      ds,
      {} as StorageService,
      undefined,
      undefined,
      undefined,
      undefined,
      lifecycle,
    );
    notifications = new NotificationsService(
      ds.getRepository(NotificationEntity),
      ds,
      {} as ConversationsService,
      realtime as unknown as RealtimeService,
      authorization,
    );
    expiry = new PostExpiryService(ds, notifications);
    realtime.emitToUser.mockClear();
  });

  it("permits exactly one of two concurrent creates for the fifth slot", async () => {
    for (let i = 0; i < 4; i++) await seed();
    const results = await Promise.allSettled([
      posts.create(dto(), context()),
      posts.create(dto(), context()),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(await lifecycle.quota(context())).toMatchObject({
      used: 5,
      remaining: 0,
    });
  });

  it("serializes create, restore and renewal competing for the last slot", async () => {
    for (let i = 0; i < 4; i++) await seed();
    const deleted = await seed({ deletedAt: new Date() });
    const expired = await seed(oldDates());
    const results = await Promise.allSettled([
      posts.create(dto(), context()),
      lifecycle.restore(deleted.id, context()),
      lifecycle.renewFree(expired.id, context()),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await lifecycle.quota(context())).toMatchObject({ used: 5 });
  });

  it("filters overdue active posts before count/pagination while the job is stopped", async () => {
    const overdue = await seed(oldDates());
    const live = await seed();
    const guest = authorization.createGuestContext();
    expect((await posts.findAll({ page: 1, limit: 1 }, guest)).meta.total).toBe(
      1,
    );
    expect(
      (await posts.search({ page: 1, limit: 1 }, guest)).items.map((p) => p.id),
    ).toEqual([live.id]);
    await expect(posts.findOne(overdue.id, guest)).rejects.toThrow(
      "Post not found",
    );
    await expect(posts.getActivePost(overdue.id)).rejects.toThrow(
      "Post not found",
    );
    await expect(posts.getReadablePost(overdue.id)).rejects.toThrow(
      "Post not found",
    );
    expect(await lifecycle.quota(context())).toMatchObject({ used: 1 });
    const mine = await posts.findMyPosts(context(), {
      page: 1,
      limit: 20,
      status: PostStatus.EXPIRED,
    });
    expect(mine.items.map((p) => p.id)).toEqual([overdue.id]);
    expect(mine.items[0].status).toBe(PostStatus.EXPIRED);
    expect((await posts.findMyPost(overdue.id, context())).status).toBe(
      PostStatus.EXPIRED,
    );
    expect(
      (
        await posts.findMyPosts(context(), {
          page: 1,
          limit: 20,
          status: PostStatus.ACTIVE,
        })
      ).items.map((p) => p.id),
    ).toEqual([live.id]);
    const profile = new PublicUserService(
      ds,
      {} as StorageService,
      authorization,
    );
    expect(
      (await profile.posts(seller.id, { page: 1, limit: 20 }, guest)).items.map(
        (p) => p.id,
      ),
    ).toEqual([live.id]);
    await ds
      .getRepository(FavoriteEntity)
      .save(
        ds
          .getRepository(FavoriteEntity)
          .create({ userId: seller.id, postId: overdue.id }),
      );
    const favorites = new FavoritesService(
      ds.getRepository(FavoriteEntity),
      posts,
      authorization,
    );
    expect(
      (await favorites.findAll(context(), { page: 1, limit: 20 })).meta.total,
    ).toBe(0);
  });

  it("a sale frees a slot and preserves sold-post public history after its old deadline", async () => {
    const sold = await seed({
      ...oldDates(),
      status: PostStatus.SOLD,
      soldAt: new Date(),
    });
    expect(await lifecycle.quota(context())).toMatchObject({ used: 0 });
    expect(
      (await posts.findOne(sold.id, authorization.createGuestContext())).id,
    ).toBe(sold.id);
  });

  it("concurrent free renewals create one cycle, and later renewal requires payment", async () => {
    const post = await seed(oldDates());
    const results = await Promise.allSettled([
      lifecycle.renewFree(post.id, context()),
      lifecycle.renewFree(post.id, context()),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      await ds.getRepository(PostRenewalEntity).countBy({ postId: post.id }),
    ).toBe(1);
    const renewed = await ds
      .getRepository(PostEntity)
      .findOneByOrFail({ id: post.id });
    expect(renewed.expiresAt.getTime() - renewed.publishedAt.getTime()).toBe(
      14 * DAY_MS,
    );
    await ds.getRepository(PostEntity).update(post.id, oldDates());
    await expect(lifecycle.renewFree(post.id, context())).rejects.toMatchObject(
      { response: { code: "POST_PAYMENT_REQUIRED" } },
    );
  });

  it("paid renewal is idempotent and rolls back with the caller's payment transaction", async () => {
    const post = await seed({ ...oldDates(), renewalCount: 1 });
    await expect(
      ds.transaction(async (manager) => {
        await lifecycle.renewPaidWithManager(
          manager,
          post.id,
          context(),
          "payment-rollback",
        );
        throw new Error("payment transaction failed");
      }),
    ).rejects.toThrow("payment transaction failed");
    expect(
      (await ds.getRepository(PostEntity).findOneByOrFail({ id: post.id }))
        .renewalCount,
    ).toBe(1);
    expect(await ds.getRepository(PostRenewalEntity).count()).toBe(0);
    await Promise.all([
      ds.transaction((manager) =>
        lifecycle.renewPaidWithManager(
          manager,
          post.id,
          context(),
          "payment-success",
        ),
      ),
      ds.transaction((manager) =>
        lifecycle.renewPaidWithManager(
          manager,
          post.id,
          context(),
          "payment-success",
        ),
      ),
    ]);
    expect(
      (await ds.getRepository(PostEntity).findOneByOrFail({ id: post.id }))
        .renewalCount,
    ).toBe(2);
    expect(await ds.getRepository(PostRenewalEntity).count()).toBe(1);
  });

  it("restore cannot reset a deadline or bypass a posting ban", async () => {
    const post = await seed({ deletedAt: new Date() });
    decision.allowed = false;
    await expect(lifecycle.restore(post.id, context())).rejects.toMatchObject({
      response: { code: "POSTING_RESTRICTED" },
    });
    decision.allowed = true;
    const restored = await lifecycle.restore(post.id, context());
    expect(restored.expiresAt).toEqual(post.expiresAt);
    await ds
      .getRepository(PostEntity)
      .update(post.id, { ...oldDates(), deletedAt: new Date() });
    decision.allowed = false;
    expect((await lifecycle.restore(post.id, context())).status).toBe(
      PostStatus.EXPIRED,
    );
  });

  it("creates one warning/expiry notification per cycle across concurrent workers", async () => {
    const post = await seed({ expiresAt: new Date(Date.now() + 2 * DAY_MS) });
    await Promise.all([expiry.processBatch(), expiry.processBatch()]);
    await expiry.processBatch();
    expect(
      await ds
        .getRepository(NotificationEntity)
        .countBy({ type: NotificationType.POST_EXPIRING }),
    ).toBe(1);
    await ds.getRepository(PostEntity).update(post.id, oldDates());
    await Promise.all([expiry.processBatch(), expiry.processBatch()]);
    expect(
      (await ds.getRepository(PostEntity).findOneByOrFail({ id: post.id }))
        .status,
    ).toBe(PostStatus.EXPIRED);
    expect(
      await ds
        .getRepository(NotificationEntity)
        .countBy({ type: NotificationType.POST_EXPIRED }),
    ).toBe(1);
    await lifecycle.renewFree(post.id, context());
    await ds
      .getRepository(PostEntity)
      .update(post.id, { expiresAt: new Date(Date.now() + 2 * DAY_MS) });
    await expiry.processBatch();
    expect(
      await ds
        .getRepository(NotificationEntity)
        .countBy({ type: NotificationType.POST_EXPIRING }),
    ).toBe(2);
    const list = await notifications.getList(context(), { page: 1, limit: 20 });
    expect(
      list.items.every(
        (n) => n.target?.type === "my_post" && n.target.id === post.id,
      ),
    ).toBe(true);
    expect(list.snapshots).toEqual([]);
    await notifications.markAllAsRead(context());
    expect(await notifications.getUnreadCount(context())).toEqual({ total: 0 });
  });

  it("rolls back expiry when creating its notification fails", async () => {
    const post = await seed(oldDates());
    const failing = jest
      .spyOn(notifications, "createOnce")
      .mockRejectedValueOnce(new Error("notification storage failed"));
    await expect(expiry.processBatch()).rejects.toThrow(
      "notification storage failed",
    );
    failing.mockRestore();
    expect(
      (await ds.getRepository(PostEntity).findOneByOrFail({ id: post.id }))
        .status,
    ).toBe(PostStatus.ACTIVE);
    expect(realtime.emitToUser).not.toHaveBeenCalled();
    await expiry.processBatch();
    expect(await ds.getRepository(NotificationEntity).count()).toBe(1);
  });
});
