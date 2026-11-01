import { DataSource } from "typeorm";
import { randomUUID } from "crypto";
import { ReviewEditHistories1791810000000 } from "../../src/database/migrations/1791810000000-ReviewEditHistories";
import { ReviewEntity } from "../../src/modules/reviews/review.entity";
import { UserEntity } from "../../src/modules/user/user.entity";
import {
  createTestDataSource,
  disposeTestDatabase,
  initializeTestDatabase,
  ownedTestSchema,
} from "./database";
import { createTestCategory, createTestPost, createTestUser } from "./fixtures";

describe("review edit history migration", () => {
  let ds: DataSource;

  beforeAll(async () => {
    ds = createTestDataSource();
    await initializeTestDatabase(ds);
  });

  afterAll(async () => {
    if (ds) await disposeTestDatabase(ds);
  });

  it("creates the table in the test schema with protected constraints", async () => {
    const schema = ownedTestSchema(ds);
    const runner = ds.createQueryRunner();
    await runner.connect();
    try {
      const migration = new ReviewEditHistories1791810000000();
      const tableName = `${schema}.review_edit_histories`;
      if (await runner.hasTable(tableName)) {
        await runner.query(`DROP TABLE "${schema}"."review_edit_histories"`);
      }
      await migration.up(runner);
      const table = await runner.getTable(tableName);
      const schemas = (await runner.query(
        `SELECT table_schema
           FROM information_schema.tables
          WHERE table_name = 'review_edit_histories'`,
      )) as Array<{ table_schema: string }>;

      expect(table?.schema).toBe(schema);
      expect(schemas).toEqual([{ table_schema: schema }]);
      expect(table?.columns.map((column) => column.name)).toEqual([
        "id",
        "review_id",
        "editor_id",
        "old_rating",
        "new_rating",
        "old_comment",
        "new_comment",
        "revision",
        "edited_at",
      ]);
      expect(table?.indices).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "uq_review_edit_histories_review_revision",
            isUnique: true,
            columnNames: expect.arrayContaining(["review_id", "revision"]),
          }),
        ]),
      );
      expect(
        table?.indices.filter((index) =>
          index.columnNames.every((column) =>
            ["review_id", "revision"].includes(column),
          ),
        ),
      ).toHaveLength(1);
      expect(table?.foreignKeys).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "fk_review_edit_histories_review",
            onDelete: "RESTRICT",
          }),
          expect.objectContaining({
            name: "fk_review_edit_histories_editor",
            onDelete: "RESTRICT",
          }),
        ]),
      );

      const seller = await createTestUser(ds);
      const reviewer = await createTestUser(ds);
      const editor = await createTestUser(ds);
      const category = await createTestCategory(ds);
      const post = await createTestPost(ds, seller.id, category.id);
      const review = await ds.getRepository(ReviewEntity).save(
        ds.getRepository(ReviewEntity).create({
          reviewerId: reviewer.id,
          postId: post.id,
          rating: 4,
          comment: "original",
        }),
      );
      const historyId = randomUUID();
      await runner.query(
        `INSERT INTO "${schema}"."review_edit_histories"
          (id, review_id, editor_id, old_rating, new_rating,
           old_comment, new_comment, revision)
         VALUES ($1, $2, $3, 4, 5, 'original', 'edited', 1)`,
        [historyId, review.id, editor.id],
      );
      await expect(
        runner.query(
          `INSERT INTO "${schema}"."review_edit_histories"
            (id, review_id, editor_id, old_rating, new_rating, revision)
           VALUES ($1, $2, $3, 4, 3, 1)`,
          [randomUUID(), review.id, editor.id],
        ),
      ).rejects.toMatchObject({ driverError: { code: "23505" } });
      await expect(
        runner.query(
          `INSERT INTO "${schema}"."review_edit_histories"
            (id, review_id, editor_id, old_rating, new_rating, revision)
           VALUES ($1, $2, $3, 4, 3, 2)`,
          [randomUUID(), randomUUID(), editor.id],
        ),
      ).rejects.toMatchObject({ driverError: { code: "23503" } });
      await expect(
        runner.query(
          `INSERT INTO "${schema}"."review_edit_histories"
            (id, review_id, editor_id, old_rating, new_rating, revision)
           VALUES ($1, $2, $3, 4, 3, 2)`,
          [randomUUID(), review.id, randomUUID()],
        ),
      ).rejects.toMatchObject({ driverError: { code: "23503" } });
      await expect(
        ds.getRepository(ReviewEntity).delete(review.id),
      ).rejects.toMatchObject({
        driverError: { code: "23503" },
      });
      await expect(
        ds.getRepository(UserEntity).delete(editor.id),
      ).rejects.toMatchObject({
        driverError: { code: "23503" },
      });

      await migration.down(runner);
      expect(await runner.hasTable(tableName)).toBe(false);
      expect(await runner.hasTable(`${schema}.reviews`)).toBe(true);
    } finally {
      await runner.release();
    }
  });
});
