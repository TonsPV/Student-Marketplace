import { DataSource } from "typeorm";
import { AuthorizationService } from "../../src/modules/authorization/authorization.service";
import { CaslAbilityFactory } from "../../src/modules/authorization/casl-ability.factory";
import { CategoryEntity } from "../../src/modules/categories/category.entity";
import { FindPostsDto } from "../../src/modules/posts/dto/find-posts.dto";
import { SearchPostsDto } from "../../src/modules/posts/dto/search-posts.dto";
import { PostEntity, PostStatus } from "../../src/modules/posts/post.entity";
import {
  PostPromotionEntity,
  PromotionStatus,
} from "../../src/modules/posts/post-promotion.entity";
import { PostsService } from "../../src/modules/posts/posts.service";
import { StorageService } from "../../src/modules/storage/storage.service";
import { ModerationService } from "../../src/modules/moderation/moderation.service";
import { ReviewEntity } from "../../src/modules/reviews/review.entity";
import {
  createTestDataSource,
  initializeTestDatabase,
  disposeTestDatabase,
} from "./database";
import { createTestUser, createTestCategory, createTestPost } from "./fixtures";

/**
 * Unified Ranking fixtures (Phase 4 Step 2 §E3). Reputation is built from
 * SOLD review-carrier posts (eligible for the aggregate, excluded from the
 * listing); every listing post lives in a dedicated category. createdAt is
 * set in REVERSE of the expected order so only the ranking policy — not
 * recency — can produce the expected sequence.
 */
describe("unified ranking with promotion and expiration", () => {
  let ds: DataSource;
  let service: PostsService;
  let category: CategoryEntity;
  const authorization = new AuthorizationService(new CaslAbilityFactory());
  const now = Date.now();
  const PAST = new Date(now - 60_000);
  const FUTURE = new Date(now + 24 * 60 * 60 * 1000);
  const EXPIRED = new Date(now - 1000);

  /** Seller whose reputation derives from `ratings` on SOLD carrier posts. */
  async function sellerWithReputation(ratings: number[]) {
    const seller = await createTestUser(ds);
    for (const rating of ratings) {
      const carrier = await createTestPost(ds, seller.id, category.id, {
        status: PostStatus.SOLD,
      });
      const reviewer = await createTestUser(ds);
      await ds.getRepository(ReviewEntity).save({
        reviewerId: reviewer.id,
        postId: carrier.id,
        rating,
        comment: null,
      });
    }
    return seller;
  }

  const listingPost = (sellerId: string, overrides: Partial<PostEntity> = {}) =>
    createTestPost(ds, sellerId, category.id, overrides);

  const promote = async (
    postId: string,
    overrides: Partial<PostPromotionEntity> = {},
  ) =>
    ds.getRepository(PostPromotionEntity).save({
      postId,
      startsAt: PAST,
      endsAt: FUTURE,
      createdById: (await createTestUser(ds)).id,
      cancelledAt: null,
      cancelledById: null,
      ...overrides,
    });

  const findAll = (query: Partial<FindPostsDto> = {}) =>
    service.findAll(
      Object.assign(new FindPostsDto(), query),
      authorization.createGuestContext(),
    );
  const search = (query: Partial<SearchPostsDto> = {}) =>
    service.search(
      Object.assign(new SearchPostsDto(), query),
      authorization.createGuestContext(),
    );

  beforeAll(async () => {
    ds = createTestDataSource();
    await initializeTestDatabase(ds);
    service = new PostsService(
      ds.getRepository(PostEntity),
      ds.getRepository(CategoryEntity),
      authorization,
      ds,
      {} as StorageService,
      new ModerationService(ds, authorization),
    );
    category = await createTestCategory(ds);

    // createdAt in REVERSE of the expected ranking: F is the newest, A the
    // oldest — only the ranking policy can produce the expected order.
    let seq = 0;
    const created = () => new Date(now - 1000 * 60 * 60 * ++seq);

    const excellent = await sellerWithReputation([5, 5, 5]);
    const good = await sellerWithReputation([4, 4, 4]);
    const medium = await sellerWithReputation([3, 3, 4]);
    const insufficient = await sellerWithReputation([5, 4]);
    const unrated = await sellerWithReputation([]);
    const low = await sellerWithReputation([2, 2, 2]);

    // | Post | Reputation   | Promotion        | Expires |
    const A = await listingPost(excellent.id, {
      title: "A excellent boosted",
      createdAt: created(),
      expiresAt: FUTURE,
    });
    const B = await listingPost(excellent.id, {
      title: "B excellent plain",
      createdAt: created(),
      expiresAt: FUTURE,
    });
    const C = await listingPost(good.id, {
      title: "C good boosted",
      createdAt: created(),
      expiresAt: FUTURE,
    });
    const D = await listingPost(medium.id, {
      title: "D medium plain",
      createdAt: created(),
      expiresAt: FUTURE,
    });
    const I = await listingPost(insufficient.id, {
      title: "I insufficient plain",
      createdAt: created(),
      expiresAt: FUTURE,
    });
    const E = await listingPost(unrated.id, {
      title: "E unrated boosted",
      createdAt: created(),
      expiresAt: FUTURE,
    });
    const F = await listingPost(low.id, {
      title: "F low boosted",
      createdAt: created(),
      expiresAt: FUTURE,
    });
    // G: eligible seller + active promotion, but the POST itself expired.
    const G = await listingPost(excellent.id, {
      title: "G excellent expired post",
      createdAt: created(),
      expiresAt: EXPIRED,
    });
    // H: eligible post with an EXPIRED promotion — must not be boosted.
    const H = await listingPost(excellent.id, {
      title: "H excellent expired promo",
      createdAt: created(),
      expiresAt: FUTURE,
    });
    const S = await listingPost(good.id, {
      title: "S good scheduled promo",
      createdAt: created(),
      expiresAt: FUTURE,
    });
    const X = await listingPost(good.id, {
      title: "X good cancelled promo",
      createdAt: created(),
      expiresAt: FUTURE,
    });
    const W = await listingPost(good.id, {
      title: "W good two active promos",
      createdAt: created(),
      expiresAt: FUTURE,
    });

    await promote(A.id);
    await promote(C.id);
    await promote(E.id);
    await promote(F.id);
    await promote(G.id);
    await promote(H.id, { endsAt: PAST });
    await promote(S.id, {
      startsAt: FUTURE,
      endsAt: new Date(now + 2 * 24 * 60 * 60 * 1000),
    });
    const cancelled = await promote(X.id);
    await ds
      .getRepository(PostPromotionEntity)
      .update(cancelled.id, { cancelledAt: new Date() });
    // W has two overlapping ACTIVE promotions — must still appear once.
    await promote(W.id, { endsAt: new Date(now + 12 * 60 * 60 * 1000) });
    await promote(W.id, {
      startsAt: new Date(now + 6 * 60 * 60 * 1000),
      endsAt: new Date(now + 36 * 60 * 60 * 1000),
    });
  });


  afterAll(async () => {
    if (ds) await disposeTestDatabase(ds);
  });

  it("RECOMMENDED: reputation first, then active promotion, then rating; expired post excluded", async () => {
    const result = await findAll({ categoryId: category.id });
    const titles = result.items.map((post) => post.title);
    // A before B (same EXCELLENT seller, promotion boost); C before D;
    // INSUFFICIENT_DATA above UNRATED; UNRATED+promo still above LOW+promo;
    // G (expired post) excluded; H (expired promo) not boosted; W appears
    // exactly once despite two active promotions.
    expect(titles).toEqual([
      "A excellent boosted",
      "H excellent expired promo",
      "B excellent plain",
      "C good boosted",
      "W good two active promos",
      "S good scheduled promo",
      "X good cancelled promo",
      "D medium plain",
      "I insufficient plain",
      "E unrated boosted",
      "F low boosted",
    ]);
    expect(result.meta.total).toBe(11);
  });

  it("promotion lifecycle states present in fixtures (active/scheduled/expired/cancelled)", async () => {
    const promotions = await ds
      .getRepository(PostPromotionEntity)
      .createQueryBuilder("promotion")
      .getMany();
    const at = new Date();
    const statuses = promotions.map((promotion) => {
      if (promotion.cancelledAt) return PromotionStatus.CANCELLED;
      if (promotion.startsAt.getTime() > at.getTime())
        return PromotionStatus.SCHEDULED;
      if (promotion.endsAt.getTime() <= at.getTime())
        return PromotionStatus.EXPIRED;
      return PromotionStatus.ACTIVE;
    });
    for (const status of [
      PromotionStatus.ACTIVE,
      PromotionStatus.SCHEDULED,
      PromotionStatus.EXPIRED,
      PromotionStatus.CANCELLED,
    ]) {
      expect(statuses).toContain(status);
    }
  });

  it("REPUTATION_HIGH_TO_LOW has no promotion boost (pure reputation order)", async () => {
    const result = await search({
      categoryId: category.id,
      sort: "REPUTATION_HIGH_TO_LOW" as never,
    });
    const titles = result.items.map((post) => post.title);
    // Same EXCELLENT seller: without the boost the tie-breaker is createdAt
    // DESC — H/B created later than A. G remains excluded (expired post).
    expect(titles.slice(0, 3)).toEqual([
      "H excellent expired promo",
      "B excellent plain",
      "A excellent boosted",
    ]);
    expect(titles).toContain("F low boosted");
    expect(titles).not.toContain("G excellent expired post");
  });

  it("NEWEST ignores reputation and promotion", async () => {
    const result = await search({
      categoryId: category.id,
      sort: "NEWEST" as never,
    });
    const titles = result.items.map((post) => post.title);
    expect(titles[0]).toBe("F low boosted"); // newest createdAt
    expect(titles).not.toContain("G excellent expired post");
  });

  it("pagination runs after eligibility+ranking: no duplicates across pages, correct total", async () => {
    const page1 = await findAll({ categoryId: category.id, page: 1, limit: 4 });
    const page2 = await findAll({ categoryId: category.id, page: 2, limit: 4 });
    const page3 = await findAll({ categoryId: category.id, page: 3, limit: 4 });
    expect(page1.meta.total).toBe(11);
    expect(page1.items).toHaveLength(4);
    expect(page2.items).toHaveLength(4);
    expect(page3.items).toHaveLength(3);
    const ids = [...page1.items, ...page2.items, ...page3.items].map(
      (post) => post.id,
    );
    expect(new Set(ids).size).toBe(ids.length);
    const full = await findAll({ categoryId: category.id });
    expect(ids).toEqual(full.items.map((post) => post.id));
  });

  it("reputation filter keeps working with promotion/expiry present", async () => {
    const excellent = await findAll({
      categoryId: category.id,
      reputationLevel: "EXCELLENT" as never,
    });
    expect(excellent.items.map((post) => post.title)).toEqual([
      "A excellent boosted",
      "H excellent expired promo",
      "B excellent plain",
    ]);
    const low = await findAll({
      categoryId: category.id,
      reputationLevel: "LOW" as never,
    });
    expect(low.items.map((post) => post.title)).toEqual(["F low boosted"]);
  });
});

