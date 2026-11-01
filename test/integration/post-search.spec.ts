import { DataSource } from "typeorm";
import { PostSearchUnaccent1791760000000 } from "../../src/database/migrations/1791760000000-PostSearchUnaccent";
import { AuthorizationService } from "../../src/modules/authorization/authorization.service";
import { CaslAbilityFactory } from "../../src/modules/authorization/casl-ability.factory";
import { CategoryEntity } from "../../src/modules/categories/category.entity";
import { SearchPostsDto } from "../../src/modules/posts/dto/search-posts.dto";
import { PostEntity, PostStatus } from "../../src/modules/posts/post.entity";
import { PostsService } from "../../src/modules/posts/posts.service";
import { StorageService } from "../../src/modules/storage/storage.service";
import { PostImageEntity } from "../../src/modules/post-images/post-image.entity";
import { ModerationService } from "../../src/modules/moderation/moderation.service";
import {
  createTestDataSource,
  initializeTestDatabase,
  disposeTestDatabase,
  ownedTestSchema,
} from "./database";
import { createTestUser, createTestCategory, createTestPost } from "./fixtures";

describe("accent-insensitive post search", () => {
  let ds: DataSource;
  let service: PostsService;
  let titlePost: PostEntity, descriptionPost: PostEntity;
  const authorization = new AuthorizationService(new CaslAbilityFactory());
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
    const seller = await createTestUser(ds);
    const otherSeller = await createTestUser(ds);
    const category = await createTestCategory(ds);
    const otherCategory = await createTestCategory(ds);
    titlePost = await createTestPost(ds, seller.id, category.id, {
      title: "Điện thoại Samsung",
      description: "Còn mới",
      price: "1000000",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      location: { type: "Point", coordinates: [106.7009, 10.7769] },
    });
    descriptionPost = await createTestPost(
      ds,
      otherSeller.id,
      otherCategory.id,
      {
        title: "Đồ dùng sinh viên",
        description: "Có điện thoại và sách giáo khoa",
        price: "2000000",
        createdAt: new Date("2026-01-02T00:00:00Z"),
        location: { type: "Point", coordinates: [105.8342, 21.0278] },
      },
    );
    for (const status of [PostStatus.SOLD, PostStatus.HIDDEN]) {
      await createTestPost(ds, seller.id, category.id, {
        title: "Điện thoại",
        status,
      });
    }
    await createTestPost(ds, seller.id, category.id, {
      title: "Điện thoại",
      deletedAt: new Date(),
    });
  });
  afterAll(async () => {
    if (ds) await disposeTestDatabase(ds);
  });

  it.each(["dien thoai", "ĐIỆN THOẠI", "điện thoại", "điện thoại"])(
    "matches title and description for %s, newest first",
    async (q) => {
      const result = await search({ q });
      expect(result.items.map((post) => post.id)).toEqual([
        descriptionPost.id,
        titlePost.id,
      ]);
      expect(result.meta).toEqual({
        page: 1,
        limit: 20,
        total: 2,
        totalPages: 1,
      });
      expect(result.items[1]).toMatchObject({
        title: "Điện thoại Samsung",
        distance: null,
        location: { latitude: 10.7769, longitude: 106.7009 },
      });
      expect(result.items[1].seller).not.toHaveProperty("avatarStorageKey");
      expect(Object.keys(result).sort()).toEqual(["items", "meta"]);
    },
  );

  it("handles đ/Đ and does not match misspellings", async () => {
    expect(
      (await search({ q: "DO DUNG" })).items.map((post) => post.id),
    ).toEqual([descriptionPost.id]);
    expect((await search({ q: "dien thoaai" })).meta.total).toBe(0);
    expect(
      (await search({ q: "sach giao khoa" })).items.map((post) => post.id),
    ).toEqual([descriptionPost.id]);
  });

  it("returns one cover per post without changing totals, pagination or gallery order", async () => {
    const images = ds.getRepository(PostImageEntity);
    const inserted = await images.save([
      images.create({
        id: "bbbbbbbb-bbbb-4bbb-8bbb-000000000002",
        postId: titlePost.id,
        url: "https://example.test/second.jpg",
        storageKey: null,
      }),
      images.create({
        id: "bbbbbbbb-bbbb-4bbb-8bbb-000000000001",
        postId: titlePost.id,
        url: "https://example.test/first.jpg",
        storageKey: null,
      }),
    ]);
    try {
      const first = await search({ q: "dien thoai", limit: 1 });
      expect(first.items[0]).toMatchObject({
        id: descriptionPost.id,
        thumbnailUrl: null,
      });
      expect(first.meta).toMatchObject({ total: 2, totalPages: 2 });
      const second = await search({ q: "dien thoai", limit: 1, page: 2 });
      expect(second.items[0]).toMatchObject({
        id: titlePost.id,
        thumbnailUrl: "https://example.test/first.jpg",
        category: { id: titlePost.categoryId },
      });
      expect(second.items[0]).not.toHaveProperty("images");
      expect(second.items[0]).not.toHaveProperty("storageKey");
      expect(second.meta.total).toBe(2);
    } finally {
      await images.delete(inserted.map((image) => image.id));
    }
  });

  it("preserves category, seller, exclusion, price and pagination filters", async () => {
    for (const filter of [
      { categoryId: titlePost.categoryId },
      { sellerId: titlePost.sellerId },
      { excludePostId: descriptionPost.id },
      { minPrice: 1000000, maxPrice: 1500000 },
    ]) {
      expect(
        (await search({ q: "thoai dien", ...filter })).items.map(
          (post) => post.id,
        ),
      ).toEqual([titlePost.id]);
    }
    const result = await search({ q: "dien thoai", page: 2, limit: 1 });
    expect(result.items.map((post) => post.id)).toEqual([titlePost.id]);
    expect(result.meta).toEqual({ page: 2, limit: 1, total: 2, totalPages: 2 });
    expect((await search()).meta.total).toBe(2);
    await expect(search({ minPrice: 2, maxPrice: 1 })).rejects.toThrow(
      "minPrice",
    );
  });

  it("matches all separated keywords in any order, including across fields", async () => {
    const repo = ds.getRepository(PostEntity);
    const book = await createTestPost(
      ds,
      titlePost.sellerId,
      titlePost.categoryId,
      {
        title: "Sách bài tập Toán 3 có lời giải",
        description: "Dành cho học sinh",
      },
    );
    const crossFields = await createTestPost(
      ds,
      titlePost.sellerId,
      titlePost.categoryId,
      {
        title: "Sách bài tập",
        description: "Toán lớp 3 có lời giải",
      },
    );
    const missingNumber = await createTestPost(
      ds,
      titlePost.sellerId,
      titlePost.categoryId,
      {
        title: "Sách bài tập Toán 4",
        description: "Có lời giải",
      },
    );
    const missingSubject = await createTestPost(
      ds,
      titlePost.sellerId,
      titlePost.categoryId,
      {
        title: "Sách tiếng Anh 3",
        description: "Có lời giải",
      },
    );
    try {
      for (const q of [
        "sach toan 3",
        "3 TOÁN sách",
        "  sach   toan\t3\n",
        "sach sach toan 3",
        "sách toán lời giải 3",
      ]) {
        const result = await search({ q });
        expect(result.items.map((post) => post.id).sort()).toEqual(
          [book.id, crossFields.id].sort(),
        );
        expect(result.meta.total).toBe(2);
      }
      expect((await search({ q: "sach toann 3" })).meta.total).toBe(0);
      const result = await search({
        q: "3 toan sach",
        excludePostId: crossFields.id,
        limit: 1,
      });
      expect(result.items.map((post) => post.id)).toEqual([book.id]);
      expect(result.meta).toEqual({
        page: 1,
        limit: 1,
        total: 1,
        totalPages: 1,
      });
    } finally {
      await repo.delete([
        book.id,
        crossFields.id,
        missingNumber.id,
        missingSubject.id,
      ]);
    }
  });

  it("preserves PostGIS radius filtering and distance", async () => {
    const result = await search({
      q: "dien thoai",
      lat: 10.7769,
      lng: 106.7009,
      radius: 1000,
    });
    expect(result.items.map((post) => post.id)).toEqual([titlePost.id]);
    expect(result.items[0].distance).toBeCloseTo(0);
    expect(result.meta.total).toBe(1);
  });

  it("updates indexed content after editing a post and preserves wildcard behavior", async () => {
    const repo = ds.getRepository(PostEntity);
    try {
      await repo.update(titlePost.id, { title: "Máy tính xách tay" });
      expect(
        (await search({ q: "may tinh" })).items.map((post) => post.id),
      ).toEqual([titlePost.id]);
      expect(
        (await search({ q: "dien thoai" })).items.map((post) => post.id),
      ).toEqual([descriptionPost.id]);
      expect((await search({ q: "may%tay" })).meta.total).toBe(1);
      expect((await search({ q: "' OR 1=1 --" })).meta.total).toBe(0);
    } finally {
      await repo.update(titlePost.id, { title: titlePost.title });
    }
  });

  it("uses both GIN expression indexes and preserves them during synchronize", async () => {
    await ds.synchronize();
    const schema = ownedTestSchema(ds);
    const runner = ds.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      // Small fixtures normally favor sequential scans; this checks index eligibility.
      await runner.query("SET LOCAL enable_seqscan = off");
      const plans = await runner.query(
        `EXPLAIN (FORMAT JSON) SELECT id FROM "${schema}".posts
        WHERE status = 'active' AND deleted_at IS NULL AND
        ("${schema}".post_search_unaccent(title) ILIKE "${schema}".post_search_unaccent($1)
        OR "${schema}".post_search_unaccent(description) ILIKE "${schema}".post_search_unaccent($1)) AND
        ("${schema}".post_search_unaccent(title) ILIKE "${schema}".post_search_unaccent($2)
        OR "${schema}".post_search_unaccent(description) ILIKE "${schema}".post_search_unaccent($2))`,
        ["%dien%", "%thoai%"],
      );
      expect(JSON.stringify(plans)).toContain("idx_posts_title_unaccent_trgm");
      expect(JSON.stringify(plans)).toContain(
        "idx_posts_description_unaccent_trgm",
      );
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  });

  it("selects the indexes with realistic row counts without forcing the planner", async () => {
    const schema = ownedTestSchema(ds);
    const runner = ds.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await runner.query(
        `INSERT INTO "${schema}".posts
        (id, seller_id, category_id, title, description, price, condition, status)
        SELECT md5('search-plan-fixture-' || g)::uuid, p.seller_id, p.category_id,
          'Laptop ' || g, 'Used textbook number ' || g, p.price, p.condition, p.status
        FROM "${schema}".posts p CROSS JOIN generate_series(1, 10000) g WHERE p.id=$1`,
        [titlePost.id],
      );
      await runner.query(`ANALYZE "${schema}".posts`);
      const plans = await runner.query(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
        SELECT id FROM "${schema}".posts WHERE status = $2 AND deleted_at IS NULL AND
        ("${schema}".post_search_unaccent(title) ILIKE "${schema}".post_search_unaccent($1)
        OR "${schema}".post_search_unaccent(description) ILIKE "${schema}".post_search_unaccent($1)) AND
        ("${schema}".post_search_unaccent(title) ILIKE "${schema}".post_search_unaccent($3)
        OR "${schema}".post_search_unaccent(description) ILIKE "${schema}".post_search_unaccent($3))
        ORDER BY created_at DESC LIMIT 20`,
        ["%dien%", PostStatus.ACTIVE, "%thoai%"],
      );
      expect(JSON.stringify(plans)).toContain("idx_posts_title_unaccent_trgm");
      expect(JSON.stringify(plans)).toContain(
        "idx_posts_description_unaccent_trgm",
      );
      expect(plans[0]["QUERY PLAN"][0].Plan["Actual Rows"]).toBe(2);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  });

  it("rolls back only its own objects even with a different search_path", async () => {
    const schema = ownedTestSchema(ds);
    const runner = ds.createQueryRunner();
    await runner.connect();
    try {
      await runner.query("SET search_path TO public, extensions");
      const migration = new PostSearchUnaccent1791760000000();
      await migration.down(runner);
      expect(
        await runner.query(
          "SELECT indexname FROM pg_indexes WHERE schemaname=$1 AND indexname LIKE 'idx_posts_%_unaccent_trgm'",
          [schema],
        ),
      ).toHaveLength(0);
      expect(
        await runner.query(
          "SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 AND p.proname='post_search_unaccent'",
          [schema],
        ),
      ).toHaveLength(0);
      expect(await ds.getRepository(PostEntity).count()).toBe(4);
      expect(
        await runner.query(
          "SELECT extname FROM pg_extension WHERE extname IN ('unaccent', 'pg_trgm')",
        ),
      ).toHaveLength(2);
      await migration.up(runner);
      expect((await search({ q: "dien thoai" })).meta.total).toBe(2);
    } finally {
      await runner.release();
    }
  });
});
