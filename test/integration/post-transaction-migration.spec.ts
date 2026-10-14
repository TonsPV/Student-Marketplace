import "reflect-metadata";
import { DataSource } from "typeorm";
import { PostTransactionInvariant1791790000000 } from "../../src/database/migrations/1791790000000-PostTransactionInvariant";
import { PostTimestampAndReviewInvariant1791780000000 } from "../../src/database/migrations/1791780000000-PostTimestampAndReviewInvariant";
import { PostStatus } from "../../src/modules/posts/post.entity";
import { createTestCategory, createTestPost, createTestUser } from "./fixtures";
import {
  createTestDataSource,
  disposeTestDatabase,
  initializeTestDatabase,
  ownedTestSchema,
} from "./database";

describe("post transaction invariant migration", () => {
  let ds: DataSource;

  beforeAll(async () => {
    ds = createTestDataSource();
    await initializeTestDatabase(ds);
  });

  afterAll(async () => {
    if (ds) await disposeTestDatabase(ds);
  });

  it("refuses invalid existing rows without deleting them and restores its constraint on down", async () => {
    const schema = ownedTestSchema(ds);
    const seller = await createTestUser(ds);
    const category = await createTestCategory(ds);
    const post = await createTestPost(ds, seller.id, category.id);
    const buyer = await createTestUser(ds);
    const migration = new PostTransactionInvariant1791790000000();
    const runner = ds.createQueryRunner();
    await runner.connect();

    try {
      await runner.query(
        `UPDATE "${schema}"."posts"
            SET status = $1, buyer_id = $2, sold_at = NULL
          WHERE id = $3`,
        [PostStatus.SOLD, buyer.id, post.id],
      );

      await expect(migration.up(runner)).rejects.toThrow("invalid rows found");
      expect(
        await runner.query(
          `SELECT status, buyer_id, sold_at
             FROM "${schema}"."posts" WHERE id = $1`,
          [post.id],
        ),
      ).toEqual([
        expect.objectContaining({
          status: PostStatus.SOLD,
          buyer_id: buyer.id,
          sold_at: null,
        }),
      ]);

      await runner.query(
        `UPDATE "${schema}"."posts"
            SET sold_at = clock_timestamp()
          WHERE id = $1`,
        [post.id],
      );
      await migration.up(runner);
      await expect(
        runner.query(
          `UPDATE "${schema}"."posts"
              SET sold_at = NULL WHERE id = $1`,
          [post.id],
        ),
      ).rejects.toMatchObject({ code: "23514" });

      await runner.query(
        `UPDATE "${schema}"."posts"
            SET status = $1
          WHERE id = $2`,
        [PostStatus.HIDDEN, post.id],
      );
      expect(
        await runner.query(
          `SELECT status, buyer_id, sold_at
             FROM "${schema}"."posts" WHERE id = $1`,
          [post.id],
        ),
      ).toEqual([
        expect.objectContaining({
          status: PostStatus.HIDDEN,
          buyer_id: buyer.id,
          sold_at: expect.anything(),
        }),
      ]);

      await expect(
        runner.query(
          `UPDATE "${schema}"."posts"
              SET sold_at = NULL WHERE id = $1`,
          [post.id],
        ),
      ).rejects.toMatchObject({ code: "23514" });

      await migration.down(runner);
      await expect(
        runner.query(
          `UPDATE "${schema}"."posts"
              SET sold_at = NULL WHERE id = $1`,
          [post.id],
        ),
      ).resolves.toBeDefined();
    } finally {
      await runner.release();
    }
  });

  it("restores the review index and post timestamp type on timestamp migration down", async () => {
    const schema = ownedTestSchema(ds);
    const migration = new PostTimestampAndReviewInvariant1791780000000();
    const runner = ds.createQueryRunner();
    await runner.connect();

    try {
      await migration.up(runner);
      await migration.down(runner);

      expect(
        await runner.query(
          `SELECT data_type
             FROM information_schema.columns
            WHERE table_schema = $1
              AND table_name = 'posts'
              AND column_name = 'created_at'`,
          [schema],
        ),
      ).toEqual([{ data_type: "timestamp without time zone" }]);
      expect(
        await runner.query(
          `SELECT 1 FROM pg_indexes
            WHERE schemaname = $1
              AND indexname = 'uq_reviews_post_id'`,
          [schema],
        ),
      ).toHaveLength(1);
    } finally {
      await runner.release();
    }
  });
});
