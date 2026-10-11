import { DataSource } from "typeorm";
import { uuidv7 } from "uuidv7";
import { Favorites1791720000000 } from "../../src/database/migrations/1791720000000-Favorites";
import { FavoriteEntity } from "../../src/modules/favorites/favorite.entity";
import { PostEntity } from "../../src/modules/posts/post.entity";
import {
  createTestDataSource,
  initializeTestDatabase,
  disposeTestDatabase,
  ownedTestSchema,
} from "./database";
import { createTestUser, createTestCategory, createTestPost } from "./fixtures";

describe("favorites migration", () => {
  let ds: DataSource;
  beforeAll(async () => {
    ds = createTestDataSource();
    await initializeTestDatabase(ds);
  });
  afterAll(async () => {
    if (ds) await disposeTestDatabase(ds);
  });

  it("creates the missing table in the configured schema and preserves existing favorites", async () => {
    const schema = ownedTestSchema(ds);
    const user = await createTestUser(ds);
    const post = await createTestPost(
      ds,
      user.id,
      (await createTestCategory(ds)).id,
    );
    const runner = ds.createQueryRunner();
    await runner.connect();
    const migration = new Favorites1791720000000();
    try {
      await runner.dropTable(`${schema}.favorites`);
      // A public search_path must not redirect this migration outside its owned schema.
      await runner.query("SET search_path TO public, extensions");
      await migration.up(runner);
      const table = await runner.getTable(`${schema}.favorites`);
      expect(table?.indices.map((index) => index.name)).toEqual(
        expect.arrayContaining([
          "idx_favorites_user_created",
          "idx_favorites_post_id",
        ]),
      );
      expect(
        table?.foreignKeys.every((key) => key.onDelete === "CASCADE"),
      ).toBe(true);
      const repo = ds.getRepository(FavoriteEntity);
      const favorite = await repo.save(
        repo.create({ userId: user.id, postId: post.id }),
      );
      expect(favorite.id).toBeTruthy();
      expect(await repo.countBy({ userId: user.id })).toBe(1);
      await migration.up(runner);
      expect(await repo.findOneByOrFail({ id: favorite.id })).toMatchObject({
        userId: user.id,
        postId: post.id,
      });
      await expect(
        repo.save(repo.create({ userId: user.id, postId: post.id })),
      ).rejects.toMatchObject({
        driverError: { code: "23505", constraint: "uq_favorites_user_post" },
      });
      await expect(
        repo.save(repo.create({ userId: user.id, postId: uuidv7() })),
      ).rejects.toMatchObject({ driverError: { code: "23503" } });
      await expect(migration.down(runner)).rejects.toThrow("contain user data");
      await ds.getRepository(PostEntity).delete(post.id);
      expect(await repo.count()).toBe(0);
      await migration.down(runner);
      expect(await runner.hasTable(`${schema}.favorites`)).toBe(false);
    } finally {
      await runner.release();
    }
  });
});
