import { DataSource } from "typeorm";
import { PostLifecycle1791810000000 } from "../../src/database/migrations/1791810000000-PostLifecycle";
import {
  createTestDataSource,
  disposeTestDatabase,
  ownedTestSchema,
} from "./database";

describe("post lifecycle migration", () => {
  let ds: DataSource;
  beforeAll(async () => {
    ds = createTestDataSource();
    await ds.initialize();
    const schema = ownedTestSchema(ds);
    await ds.query(`CREATE SCHEMA "${schema}"`);
    await ds.query(
      `CREATE TYPE "${schema}".posts_status_enum AS ENUM ('active', 'sold', 'hidden')`,
    );
    await ds.query(
      `CREATE TYPE "${schema}".notifications_type_enum AS ENUM ('new_message', 'review_request')`,
    );
    await ds.query(`CREATE TABLE "${schema}".posts (
      id uuid PRIMARY KEY, seller_id uuid NOT NULL, status "${schema}".posts_status_enum NOT NULL DEFAULT 'active',
      buyer_id uuid, sold_at timestamptz, deleted_at timestamptz,
      created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
    )`);
    await ds.query(
      `CREATE TABLE "${schema}".notifications (id uuid PRIMARY KEY, type "${schema}".notifications_type_enum NOT NULL)`,
    );
    await ds.query(`INSERT INTO "${schema}".posts (id, seller_id, status, created_at, updated_at)
      VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'active', '2020-01-01T00:00:00Z', '2020-01-01T00:00:00Z')`);
  });
  afterAll(async () => {
    if (ds) await disposeTestDatabase(ds);
  });

  it("runs transactionally on old data, grants 14 days and preserves the creation date; down restores old fields", async () => {
    const schema = ownedTestSchema(ds);
    const migration = new PostLifecycle1791810000000();
    const runner = ds.createQueryRunner();
    await runner.connect();
    try {
      await runner.startTransaction();
      await migration.up(runner);
      await runner.commitTransaction();
      const [row] = await runner.query(`SELECT * FROM "${schema}".posts`);
      expect(
        new Date(row.expires_at).getTime() -
          new Date(row.published_at).getTime(),
      ).toBe(14 * 86400000);
      expect(new Date(row.created_at).getUTCFullYear()).toBe(2020);
      expect(row.renewal_count).toBe(0);
      await runner.query(`UPDATE "${schema}".posts SET status = 'expired'`);
      await expect(
        runner.query(`UPDATE "${schema}".posts SET sold_at = now()`),
      ).rejects.toMatchObject({ code: "23514" });
      await migration.down(runner);
      const [restored] = await runner.query(`SELECT * FROM "${schema}".posts`);
      expect(restored.status).toBe("active");
      expect(restored).not.toHaveProperty("expires_at");
      await expect(
        runner.query(`UPDATE "${schema}".posts SET sold_at = now()`),
      ).rejects.toMatchObject({ code: "23514" });
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
    }
  });
});
