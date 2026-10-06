import "reflect-metadata";
import { DataSource } from "typeorm";
import {
  createTestDataSource,
  initializeTestDatabase,
  disposeTestDatabase,
} from "./database";

describe("integration harness (DB test riêng)", () => {
  let ds: DataSource | null = null;

  afterEach(async () => {
    if (ds) await disposeTestDatabase(ds);
    ds = null;
  });

  it("kết nối DB test + PostGIS (fail rõ khi thiếu env)", async () => {
    ds = createTestDataSource();
    await initializeTestDatabase(ds);
    const rows = (await ds.query(`SELECT version() AS v`)) as Array<{
      v: string;
    }>;
    expect(rows[0].v).toMatch(/PostgreSQL/i);
    const ext = (await ds.query(
      `SELECT extname FROM pg_extension WHERE extname = 'postgis'`,
    )) as Array<{ extname: string }>;
    expect(ext.map((e) => e.extname)).toContain("postgis");
  });
});
