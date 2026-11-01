import {
  postExpirationConfig,
  postExpiresAt,
} from "../../src/config/post-expiration.config";

describe("post expiration config (centralized, env-driven)", () => {
  it("defaults to the proposed 30-day policy", () => {
    expect(postExpirationConfig({})).toEqual({ durationDays: 30 });
  });

  it("reads POST_EXPIRATION_DAYS", () => {
    expect(postExpirationConfig({ POST_EXPIRATION_DAYS: "60" })).toEqual({
      durationDays: 60,
    });
    expect(postExpirationConfig({ POST_EXPIRATION_DAYS: "" })).toEqual({
      durationDays: 30,
    });
  });

  it("rejects non-integer, non-positive or oversized durations", () => {
    expect(() => postExpirationConfig({ POST_EXPIRATION_DAYS: "abc" })).toThrow(
      "must be a finite number",
    );
    expect(() => postExpirationConfig({ POST_EXPIRATION_DAYS: "0" })).toThrow(
      "1..365",
    );
    expect(() => postExpirationConfig({ POST_EXPIRATION_DAYS: "30.5" })).toThrow(
      "1..365",
    );
    expect(() => postExpirationConfig({ POST_EXPIRATION_DAYS: "366" })).toThrow(
      "1..365",
    );
  });
});

describe("postExpiresAt", () => {
  it("adds the configured lifetime to now (ms-precision timestamp)", () => {
    const now = new Date("2026-06-15T12:00:00.000Z");
    expect(postExpiresAt(now, { durationDays: 30 })).toEqual(
      new Date("2026-07-15T12:00:00.000Z"),
    );
    expect(postExpiresAt(now, { durationDays: 1 })).toEqual(
      new Date("2026-06-16T12:00:00.000Z"),
    );
  });
});
