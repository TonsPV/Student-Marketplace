import { DataSource } from "typeorm";
import { uuidv7 } from "uuidv7";
import { Reviews1791750000000 } from "../../src/database/migrations/1791750000000-Reviews";
import { ReviewEntity } from "../../src/modules/reviews/review.entity";
import { PostEntity } from "../../src/modules/posts/post.entity";
import { UserEntity } from "../../src/modules/user/user.entity";
import {
  createTestDataSource,
  initializeTestDatabase,
  disposeTestDatabase,
  ownedTestSchema,
} from "./database";
import { createTestUser, createTestCategory, createTestPost } from "./fixtures";

describe("reviews migration", () => {
  let ds: DataSource;
  beforeAll(async () => {
    ds = createTestDataSource();
    await initializeTestDatabase(ds);
  });
  afterAll(async () => {
    if (ds) await disposeTestDatabase(ds);
  });

  it("creates the missing table in the configured schema, preserves reviews and protects rollback", async () => {
    const schema = ownedTestSchema(ds);
    const seller = await createTestUser(ds);
    const reviewer = await createTestUser(ds);
    const post = await createTestPost(
      ds,
      seller.id,
      (await createTestCategory(ds)).id,
    );
    const runner = ds.createQueryRunner();
    await runner.connect();
    const migration = new Reviews1791750000000();
    try {
      await runner.dropTable(`${schema}.reviews`);
      await runner.query("SET search_path TO public, extensions");
      await migration.up(runner);
      const table = await runner.getTable(`${schema}.reviews`);
      expect(table?.columns.map((column) => column.name)).toEqual([
        "id",
        "reviewer_id",
        "post_id",
        "rating",
        "comment",
        "created_at",
        "updated_at",
      ]);
      expect(table?.indices).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "uq_reviews_reviewer_post",
            isUnique: true,
            columnNames: expect.arrayContaining(["reviewer_id", "post_id"]),
          }),
          expect.objectContaining({
            name: "idx_reviews_post_created_at",
            columnNames: expect.arrayContaining(["post_id", "created_at"]),
          }),
        ]),
      );
      // TypeORM's introspection does not preserve index column order; check PostgreSQL's definition.
      const definitions = await runner.query(
        "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = 'reviews'",
        [schema],
      );
      expect(definitions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            indexname: "uq_reviews_reviewer_post",
            indexdef: expect.stringContaining("(reviewer_id, post_id)"),
          }),
          expect.objectContaining({
            indexname: "idx_reviews_post_created_at",
            indexdef: expect.stringContaining("(post_id, created_at)"),
          }),
        ]),
      );
      expect(table?.foreignKeys).toHaveLength(2);
      expect(
        table?.foreignKeys.every((key) => key.onDelete === "RESTRICT"),
      ).toBe(true);
      // The lifecycle migration adds this column after the base reviews table.
      // Keep this test focused on the base migration while matching ReviewEntity.
      await runner.query(
        `ALTER TABLE "${schema}"."reviews" ADD COLUMN "deleted_at" timestamptz`,
      );
      const repo = ds.getRepository(ReviewEntity);
      const review = await repo.save(
        repo.create({
          reviewerId: reviewer.id,
          postId: post.id,
          rating: 4,
          comment: null,
        }),
      );
      expect(review.id).toBeTruthy();
      expect(review.createdAt).toBeInstanceOf(Date);
      expect(review.updatedAt).toBeInstanceOf(Date);
      await migration.up(runner);
      expect(await repo.findOneByOrFail({ id: review.id })).toMatchObject({
        rating: 4,
        comment: null,
      });
      await expect(
        repo.save(
          repo.create({ reviewerId: reviewer.id, postId: post.id, rating: 5 }),
        ),
      ).rejects.toMatchObject({
        driverError: { code: "23505", constraint: "uq_reviews_reviewer_post" },
      });
      await expect(
        repo.save(
          repo.create({ reviewerId: reviewer.id, postId: uuidv7(), rating: 5 }),
        ),
      ).rejects.toMatchObject({ driverError: { code: "23503" } });
      await expect(
        repo.save(
          repo.create({ reviewerId: uuidv7(), postId: post.id, rating: 5 }),
        ),
      ).rejects.toMatchObject({ driverError: { code: "23503" } });
      await expect(
        ds.getRepository(PostEntity).delete(post.id),
      ).rejects.toMatchObject({ driverError: { code: "23503" } });
      await expect(
        ds.getRepository(UserEntity).delete(reviewer.id),
      ).rejects.toMatchObject({ driverError: { code: "23503" } });
      const stats = await repo
        .createQueryBuilder("review")
        .innerJoin("review.post", "post")
        .where("post.sellerId = :sellerId", { sellerId: seller.id })
        .select("AVG(review.rating)", "ratingAverage")
        .addSelect("COUNT(review.id)", "reviewCount")
        .getRawOne();
      expect(Number(stats.ratingAverage)).toBe(4);
      expect(Number(stats.reviewCount)).toBe(1);
      await expect(migration.down(runner)).rejects.toThrow("contain user data");
      expect(await repo.count()).toBe(1);
      await repo.delete(review.id);
      await migration.down(runner);
      expect(await runner.hasTable(`${schema}.reviews`)).toBe(false);
      await migration.down(runner);
    } finally {
      await runner.release();
    }
  });
});
