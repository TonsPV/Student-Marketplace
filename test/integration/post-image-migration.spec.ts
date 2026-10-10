import { DataSource } from "typeorm";
import { uuidv7 } from "uuidv7";
import { PostImageUploads1791600000000 } from "../../src/database/migrations/1791600000000-PostImageUploads";
import {
  createTestDataSource,
  initializeTestDatabase,
  disposeTestDatabase,
  ownedTestSchema,
} from "./database";
import { createTestUser, createTestCategory, createTestPost } from "./fixtures";

describe("post image migration preserves legacy URLs", () => {
  let ds: DataSource;
  beforeAll(async () => {
    ds = createTestDataSource();
    await initializeTestDatabase(ds);
  });
  afterAll(async () => {
    if (ds) await disposeTestDatabase(ds);
  });
  it("upgrades old rows, enforces one source and refuses a lossy downgrade", async () => {
    const user = await createTestUser(ds);
    const post = await createTestPost(
      ds,
      user.id,
      (await createTestCategory(ds)).id,
    );
    const runner = ds.createQueryRunner();
    await runner.connect();
    const migration = new PostImageUploads1791600000000();
    const legacyId = uuidv7();
    const keyId = uuidv7();
    try {
      await runner.query(`SET search_path TO "${ownedTestSchema(ds)}", public`);
      await runner.query(
        `ALTER TABLE post_image DROP CONSTRAINT chk_post_image_source`,
      );
      await runner.query(`ALTER TABLE post_image DROP COLUMN storage_key`);
      await runner.query(
        `ALTER TABLE post_image ALTER COLUMN url SET NOT NULL`,
      );
      await runner.query(
        `INSERT INTO post_image(id, post_id, url) VALUES ($1, $2, $3)`,
        [legacyId, post.id, "https://example.com/legacy.png"],
      );
      await migration.up(runner);
      expect(
        await runner.query(
          `SELECT url, storage_key FROM post_image WHERE id = $1`,
          [legacyId],
        ),
      ).toEqual([{ url: "https://example.com/legacy.png", storage_key: null }]);
      await expect(
        runner.query(`INSERT INTO post_image(id, post_id) VALUES ($1, $2)`, [
          uuidv7(),
          post.id,
        ]),
      ).rejects.toMatchObject({ code: "23514" });
      await runner.query(
        `INSERT INTO post_image(id, post_id, storage_key) VALUES ($1, $2, $3)`,
        [keyId, post.id, `posts/${user.id}/${uuidv7()}.png`],
      );
      await expect(migration.down(runner)).rejects.toThrow("Cannot downgrade");
      await runner.query(`DELETE FROM post_image WHERE id = $1`, [keyId]);
      await migration.down(runner);
      expect(
        await runner.query(`SELECT url FROM post_image WHERE id = $1`, [
          legacyId,
        ]),
      ).toEqual([{ url: "https://example.com/legacy.png" }]);
    } finally {
      await runner.release();
    }
  });
});
