/**
 * MODULE: POSTS (VÒNG ĐỜI TIN ĐĂNG)
 *
 * WORD TEST CASES:
 * - TC-PEC-01: Mặc định chính sách 14 ngày như đã thống nhất
 * - TC-PEC-02: Đọc cấu hình từ biến môi trường POST_EXPIRATION_DAYS
 * - TC-PEC-03: Từ chối thời hạn không nguyên, không dương hoặc vượt giới hạn
 * - TC-PEC-04: Hạn tin = now + thời hạn cấu hình (timestamp chính xác tới ms)
 */

import {
  postExpirationConfig,
  postExpiresAt,
} from "../../src/config/post-expiration.config";

describe("post expiration config (centralized, env-driven)", () => {
  // [WORD-TC: TC-PEC-01]
  // Chức năng: Mặc định chính sách 14 ngày như đã thống nhất
  it("[TC-PEC-01] Mặc định chính sách 14 ngày như đã thống nhất", () => {
    expect(postExpirationConfig({})).toEqual({ durationDays: 14 });
  });

  // [WORD-TC: TC-PEC-02]
  // Chức năng: Đọc cấu hình từ biến môi trường POST_EXPIRATION_DAYS
  it("[TC-PEC-02] Đọc cấu hình từ biến môi trường POST_EXPIRATION_DAYS", () => {
    expect(postExpirationConfig({ POST_EXPIRATION_DAYS: "60" })).toEqual({
      durationDays: 60,
    });
    expect(postExpirationConfig({ POST_EXPIRATION_DAYS: "" })).toEqual({
      durationDays: 14,
    });
  });

  // [WORD-TC: TC-PEC-03]
  // Chức năng: Từ chối thời hạn không nguyên, không dương hoặc vượt giới hạn
  it("[TC-PEC-03] Từ chối thời hạn không nguyên, không dương hoặc vượt giới hạn", () => {
    expect(() => postExpirationConfig({ POST_EXPIRATION_DAYS: "abc" })).toThrow(
      "must be a finite number",
    );
    expect(() => postExpirationConfig({ POST_EXPIRATION_DAYS: "0" })).toThrow(
      "1..365",
    );
    expect(() =>
      postExpirationConfig({ POST_EXPIRATION_DAYS: "30.5" }),
    ).toThrow("1..365");
    expect(() => postExpirationConfig({ POST_EXPIRATION_DAYS: "366" })).toThrow(
      "1..365",
    );
  });
});

describe("postExpiresAt", () => {
  // [WORD-TC: TC-PEC-04]
  // Chức năng: Hạn tin = now + thời hạn cấu hình (timestamp chính xác tới ms)
  it("[TC-PEC-04] Hạn tin = now + thời hạn cấu hình (timestamp chính xác tới ms)", () => {
    const now = new Date("2026-06-15T12:00:00.000Z");
    expect(postExpiresAt(now, { durationDays: 30 })).toEqual(
      new Date("2026-07-15T12:00:00.000Z"),
    );
    expect(postExpiresAt(now, { durationDays: 1 })).toEqual(
      new Date("2026-06-16T12:00:00.000Z"),
    );
  });
});
