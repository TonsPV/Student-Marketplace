import { DataSource } from "typeorm";
import { UserUniversityPostLocationName1791730000000 } from "../../src/database/migrations/1791730000000-UserUniversityPostLocationName";
import { UserEntity } from "../../src/modules/user/user.entity";
import { PostEntity } from "../../src/modules/posts/post.entity";
import {
  createTestDataSource,
  initializeTestDatabase,
  disposeTestDatabase,
  ownedTestSchema,
} from "./database";
import { createTestUser, createTestCategory, createTestPost } from "./fixtures";

describe("university and locationName migration", () => {
  let ds: DataSource;
  beforeAll(async () => {
    ds = createTestDataSource();
    await initializeTestDatabase(ds);
  });
  afterAll(async () => {
    if (ds) await disposeTestDatabase(ds);
  });

  it("upgrades existing rows in the configured schema and guards both columns on rollback", async () => {
    const schema = ownedTestSchema(ds);
    const user = await createTestUser(ds);
    const category = await createTestCategory(ds);
    const post = await createTestPost(ds, user.id, category.id);
    const runner = ds.createQueryRunner();
    await runner.connect();
    const migration = new UserUniversityPostLocationName1791730000000();
    const columns = () =>
      runner.query(
        `SELECT table_name, column_name, data_type, character_maximum_length, is_nullable, column_default
       FROM information_schema.columns WHERE table_schema = $1
       AND ((table_name = 'user' AND column_name = 'university')
         OR (table_name = 'posts' AND column_name = 'location_name'))
       ORDER BY table_name`,
        [schema],
      );
    try {
      await migration.down(runner);
      expect(await columns()).toEqual([]);
      await runner.query("SET search_path TO public, extensions");
      await migration.up(runner);
      expect(await columns()).toEqual([
        {
          table_name: "posts",
          column_name: "location_name",
          data_type: "character varying",
          character_maximum_length: 255,
          is_nullable: "YES",
          column_default: null,
        },
        {
          table_name: "user",
          column_name: "university",
          data_type: "character varying",
          character_maximum_length: 150,
          is_nullable: "YES",
          column_default: null,
        },
      ]);
      const users = ds.getRepository(UserEntity);
      const posts = ds.getRepository(PostEntity);
      expect(await users.findOneByOrFail({ id: user.id })).toMatchObject({
        email: user.email,
        fullName: user.fullName,
        university: null,
      });
      expect(await posts.findOneByOrFail({ id: post.id })).toMatchObject({
        title: post.title,
        sellerId: user.id,
        categoryId: category.id,
        locationName: null,
      });

      await users.update(user.id, { university: "Đại học Bách khoa" });
      await expect(migration.down(runner)).rejects.toThrow("contain user data");
      expect(await columns()).toHaveLength(2);
      expect((await users.findOneByOrFail({ id: user.id })).university).toBe(
        "Đại học Bách khoa",
      );
      await users.update(user.id, { university: null });
      await posts.update(post.id, { locationName: "Cổng trường" });
      await expect(migration.down(runner)).rejects.toThrow("contain user data");
      expect(await columns()).toHaveLength(2);
      expect((await posts.findOneByOrFail({ id: post.id })).locationName).toBe(
        "Cổng trường",
      );

      await users.update(user.id, { university: "a".repeat(150) });
      await posts.update(post.id, { locationName: "b".repeat(255) });
      await expect(
        users.update(user.id, { university: "a".repeat(151) }),
      ).rejects.toMatchObject({ driverError: { code: "22001" } });
      await expect(
        posts.update(post.id, { locationName: "b".repeat(256) }),
      ).rejects.toMatchObject({ driverError: { code: "22001" } });
      await users.update(user.id, { university: null });
      await posts.update(post.id, { locationName: null });
      await migration.down(runner);
      expect(await columns()).toEqual([]);
      await migration.up(runner);
      expect(await users.count()).toBe(1);
      expect(await posts.count()).toBe(1);
    } finally {
      await runner.release();
    }
  });
});
