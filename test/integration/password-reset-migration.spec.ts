import { DataSource } from "typeorm";
import { PasswordResetChallenges1791630000000 } from "../../src/database/migrations/1791630000000-PasswordResetChallenges";
import { PasswordResetChallengeEntity } from "../../src/modules/auth/password-reset-challenge.entity";
import {
  createTestDataSource,
  initializeTestDatabase,
  disposeTestDatabase,
  ownedTestSchema,
} from "./database";
import { createTestUser } from "./fixtures";
import { uuidv7 } from "uuidv7";

describe("password reset migration", () => {
  let ds: DataSource;
  beforeAll(async () => {
    ds = createTestDataSource();
    await initializeTestDatabase(ds);
  });
  afterAll(async () => {
    if (ds) await disposeTestDatabase(ds);
  });
  it("creates the schema, enforces constraints and foreign keys, and supports up/down", async () => {
    const user = await createTestUser(ds);
    const runner = ds.createQueryRunner();
    await runner.connect();
    const migration = new PasswordResetChallenges1791630000000();
    try {
      await runner.query(`SET search_path TO "${ownedTestSchema(ds)}", public`);
      await migration.down(runner);
      await migration.up(runner);
      const save = (
        status: string,
        attempts: number,
        userId = user.id,
        tokenHash: string | null = null,
      ) =>
        runner.query(
          `INSERT INTO password_reset_challenges (id,user_id,otp_expires_at,status,failed_attempts,reset_token_hash) VALUES ($1,$2,now(),$3,$4,$5)`,
          [uuidv7(), userId, status, attempts, tokenHash],
        );
      await save("active", 0, user.id, "a".repeat(64));
      await expect(save("invalid-status", 0)).rejects.toMatchObject({
        code: "23514",
      });
      await expect(save("active", 6)).rejects.toMatchObject({ code: "23514" });
      await expect(save("active", 0, uuidv7())).rejects.toMatchObject({
        code: "23503",
      });
      await expect(
        save("verified", 0, user.id, "a".repeat(64)),
      ).rejects.toMatchObject({ code: "23505" });
      expect(await ds.getRepository(PasswordResetChallengeEntity).count()).toBe(
        1,
      );
      const indexes = await runner.query(
        `SELECT indexname FROM pg_indexes WHERE schemaname=$1 AND tablename='password_reset_challenges'`,
        [ownedTestSchema(ds)],
      );
      expect(
        indexes.map((row: { indexname: string }) => row.indexname),
      ).toEqual(
        expect.arrayContaining([
          "idx_password_reset_user_created",
          "idx_password_reset_created",
          "idx_password_reset_token_hash",
        ]),
      );
      await migration.down(runner);
      expect(
        (
          await runner.query(
            `SELECT to_regclass('password_reset_challenges') AS table_name`,
          )
        )[0].table_name,
      ).toBeNull();
      await migration.up(runner);
    } finally {
      await runner.release();
    }
  });
});
