/**
 * MODULE: STORAGE & CẤU HÌNH
 *
 * WORD TEST CASES:
 * - TC-R2-01: Env hợp lệ → TTL mặc định 300/900 giây, dung lượng tối đa 5MB
 * - TC-R2-02: Thiếu credentials/bucket/endpoint → ném lỗi khi khởi động
 * - TC-R2-03: Endpoint phải là S3 account endpoint, không phải domain công khai
 * - TC-R2-04: TTL/size sai định dạng → ném lỗi, không fallback âm thầm
 */

import "reflect-metadata";
import { r2Config, uploadConfig } from "src/config/r2.config";

const KEYS = [
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
  "R2_ENDPOINT_URL",
  "MAX_UPLOAD_SIZE_MB",
  "SIGNED_URL_EXPIRES_SEC",
  "SIGNED_GET_URL_EXPIRES_SEC",
];

let saved: Record<string, string | undefined>;

function validEnv(): void {
  process.env.R2_ACCESS_KEY_ID = "ak";
  process.env.R2_SECRET_ACCESS_KEY = "sk";
  process.env.R2_BUCKET_NAME = "chat-private";
  process.env.R2_ENDPOINT_URL = "https://abc123.r2.cloudflarestorage.com";
  delete process.env.MAX_UPLOAD_SIZE_MB;
  delete process.env.SIGNED_URL_EXPIRES_SEC;
  delete process.env.SIGNED_GET_URL_EXPIRES_SEC;
}

beforeEach(() => {
  saved = {};
  for (const key of KEYS) saved[key] = process.env[key];
  validEnv();
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("r2/upload config startup validation (S9)", () => {
  // [WORD-TC: TC-R2-01]
  // Chức năng: Env hợp lệ → TTL mặc định 300/900 giây, dung lượng tối đa 5MB
  it("[TC-R2-01] Env hợp lệ → TTL mặc định 300/900 giây, dung lượng tối đa 5MB", () => {
    const r2 = r2Config();
    expect(r2.bucketName).toBe("chat-private");
    const upload = uploadConfig();
    expect(upload.putSignedUrlExpiresSec).toBe(300);
    expect(upload.getSignedUrlExpiresSec).toBe(900);
    expect(upload.maxFileSizeBytes).toBe(5 * 1024 * 1024);
  });

  // [WORD-TC: TC-R2-02]
  // Chức năng: Thiếu credentials/bucket/endpoint → ném lỗi khi khởi động
  it("[TC-R2-02] Thiếu credentials/bucket/endpoint → ném lỗi khi khởi động", () => {
    for (const key of [
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
      "R2_BUCKET_NAME",
      "R2_ENDPOINT_URL",
    ]) {
      const keep = process.env[key];
      delete process.env[key];
      expect(() => r2Config()).toThrow();
      process.env[key] = keep as string;
    }
    process.env.R2_ACCESS_KEY_ID = "   ";
    expect(() => r2Config()).toThrow();
  });

  // [WORD-TC: TC-R2-03]
  // Chức năng: Endpoint phải là S3 account endpoint, không phải domain công khai
  it("[TC-R2-03] Endpoint phải là S3 account endpoint, không phải domain công khai", () => {
    process.env.R2_ENDPOINT_URL = "https://pub-xyz.r2.dev";
    expect(() => r2Config()).toThrow();
    process.env.R2_ENDPOINT_URL = "http://abc.r2.cloudflarestorage.com";
    expect(() => r2Config()).toThrow();
    process.env.R2_ENDPOINT_URL = "::not-a-url::";
    expect(() => r2Config()).toThrow();
  });

  // [WORD-TC: TC-R2-04]
  // Chức năng: TTL/size sai định dạng → ném lỗi, không fallback âm thầm
  it("[TC-R2-04] TTL/size sai định dạng → ném lỗi, không fallback âm thầm", () => {
    for (const bad of ["0", "-5", "1.5", "abc", "604801", "NaN"]) {
      process.env.SIGNED_URL_EXPIRES_SEC = bad;
      expect(() => uploadConfig()).toThrow();
      process.env.SIGNED_GET_URL_EXPIRES_SEC = bad;
      expect(() => uploadConfig()).toThrow();
    }
    for (const bad of ["0", "-1", "abc", "Infinity"]) {
      process.env.MAX_UPLOAD_SIZE_MB = bad;
      expect(() => uploadConfig()).toThrow();
    }
  });
});
