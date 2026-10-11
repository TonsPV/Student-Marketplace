import { DataSource } from "typeorm";
import { AvatarStorageKey1791740000000 } from "../../src/database/migrations/1791740000000-AvatarStorageKey";
import { UserEntity } from "../../src/modules/user/user.entity";
import {
  createTestDataSource,
  initializeTestDatabase,
  disposeTestDatabase,
  ownedTestSchema,
} from "./database";
import { createTestUser } from "./fixtures";

describe("avatar storage key migration", () => {
  let ds: DataSource;
  beforeAll(async () => {
    ds = createTestDataSource();
    await initializeTestDatabase(ds);
  });
  afterAll(async () => {
    if (ds) await disposeTestDatabase(ds);
  });

  it("preserves legacy avatars and refuses to drop uploaded avatar references", async () => {
    const schema = ownedTestSchema(ds);
    const user = await createTestUser(ds);
    const legacy = "https://legacy.test/avatar.png";
    await ds.getRepository(UserEntity).update(user.id, { avatarUrl: legacy });
    const runner = ds.createQueryRunner();
    await runner.connect();
    try {
      await runner.dropColumn(`${schema}.user`, "avatar_storage_key");
      await runner.query("SET search_path TO public, extensions");
      const migration = new AvatarStorageKey1791740000000();
      await migration.up(runner);
      const repo = ds.getRepository(UserEntity);
      expect(await repo.findOneByOrFail({ id: user.id })).toMatchObject({
        avatarUrl: legacy,
        avatarStorageKey: null,
      });
      const key = `avatars/${user.id}/${user.id}.png`;
      await repo.update(user.id, { avatarStorageKey: key });
      await expect(migration.down(runner)).rejects.toThrow("contain user data");
      expect(
        (await repo.findOneByOrFail({ id: user.id })).avatarStorageKey,
      ).toBe(key);
      await repo.update(user.id, { avatarStorageKey: null });
      await migration.down(runner);
      expect(
        await runner.hasColumn(`${schema}.user`, "avatar_storage_key"),
      ).toBe(false);
      await migration.up(runner);
    } finally {
      await runner.release();
    }
  });
});
