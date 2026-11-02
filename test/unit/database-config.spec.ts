/**
 * MODULE: STORAGE & CẤU HÌNH
 *
 * WORD TEST CASES:
 * - TC-DB-01: Mặc định dùng migrations, kể cả môi trường development
 * - TC-DB-02: Cho phép chọn dùng synchronize khi phát triển một cách tường minh
 * - TC-DB-03: Từ chối synchronize ngoài môi trường development/test
 * - TC-DB-04: Từ chối schema identifier không an toàn
 */

import { databaseOptions } from "../../src/config/database.config";

describe("database synchronization safety", () => {
  // [WORD-TC: TC-DB-01]
  // Chức năng: Mặc định dùng migrations, kể cả môi trường development
  it("[TC-DB-01] Mặc định dùng migrations, kể cả môi trường development", () => {
    expect(databaseOptions({ NODE_ENV: "development" }).synchronize).toBe(
      false,
    );
  });
  // [WORD-TC: TC-DB-02]
  // Chức năng: Cho phép chọn dùng synchronize khi phát triển một cách tường minh
  it("[TC-DB-02] Cho phép chọn dùng synchronize khi phát triển một cách tường minh", () => {
    expect(
      databaseOptions({ NODE_ENV: "development", POSTGRES_SYNCHRONIZE: "true" })
        .synchronize,
    ).toBe(true);
  });
  // [WORD-TC: TC-DB-03]
  // Chức năng: Từ chối synchronize ngoài môi trường development/test
  it("[TC-DB-03] Từ chối synchronize ngoài môi trường development/test", () => {
    expect(() =>
      databaseOptions({ NODE_ENV: "production", POSTGRES_SYNCHRONIZE: "true" }),
    ).toThrow("requires NODE_ENV");
    expect(() => databaseOptions({ POSTGRES_SYNCHRONIZE: "true" })).toThrow(
      "requires NODE_ENV",
    );
  });
  // [WORD-TC: TC-DB-04]
  // Chức năng: Từ chối schema identifier không an toàn
  it("[TC-DB-04] Từ chối schema identifier không an toàn", () => {
    expect(() =>
      databaseOptions({ POSTGRES_SCHEMA: "public; DROP SCHEMA public" }),
    ).toThrow("Invalid POSTGRES_SCHEMA");
  });
});
