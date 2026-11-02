/**
 * MODULE: MODERATION & POSTING RESTRICTIONS
 *
 * WORD TEST CASES:
 * - TC-PRR-01: Restriction tạm thời chỉ active trong cửa sổ thời gian
 * - TC-PRR-02: Hết hạn: exactly at expiresAt (expiresAt <= now is inactive)
 * - TC-PRR-03: startsAt tương lai chưa active; startsAt == now thì active
 * - TC-PRR-04: Ban vĩnh viễn active cho tới khi được gỡ (lift)
 * - TC-PRR-05: Restriction tạm thời đã lift thì inactive kể cả trong cửa sổ
 * - TC-PRR-06: Chấp nhận: a temporary window and a permanent ban
 * - TC-PRR-07: Cho phép: a future startsAt
 * - TC-PRR-08: Từ chối: missing expiresAt
 * - TC-PRR-09: Từ chối: expiresAt == startsAt
 * - TC-PRR-10: Từ chối: expiresAt < startsAt
 * - TC-PRR-11: Từ chối: expiresAt in the past (with past startsAt)
 * - TC-PRR-12: Từ chối: expiresAt == now (with past startsAt)
 * - TC-PRR-13: Từ chối: permanent with expiresAt
 * - TC-PRR-14: Từ chối: unknown type
 * - TC-PRR-15: Từ chối: invalid startsAt
 * - TC-PRR-16: Từ chối: invalid expiresAt
 * - TC-PRR-17: Trả về: null when nothing is active
 * - TC-PRR-18: Ưu tiên: a permanent ban, otherwise the latest expiry
 * - TC-PRR-19: Tạo: a 403 with code, type, reason and ISO expiresAt
 * - TC-PRR-20: Từ chối: now 10:00, startsAt 08:00, expiresAt 09:00 (already expired)
 * - TC-PRR-21: Từ chối: expiresAt == now
 * - TC-PRR-22: Từ chối: expiresAt < startsAt and expiresAt == startsAt
 * - TC-PRR-23: Chấp nhận: expiresAt later than both now and startsAt
 * - TC-PRR-24: Chấp nhận: a future startsAt with a later expiresAt
 * - TC-PRR-25: Loại PERMANENT bắt buộc expiresAt = null
 * - TC-PRR-26: Active khi now == startsAt; inactive khi now == expiresAt
 * - TC-PRR-27: So sánh theo thời điểm tuyệt đối, không theo chuỗi (múi giờ tương đương)
 */

import { BadRequestException, ForbiddenException } from "@nestjs/common";
import {
  PostingRestrictionType,
  assertValidRestrictionWindow,
  isRestrictionActive,
  mostSevereRestriction,
  postingRestrictedException,
} from "../../src/modules/moderation/posting-restriction.rules";

const NOW = new Date("2026-11-01T10:00:00.000Z");
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);
const HOUR = 3_600_000;

function window(overrides: Partial<Parameters<typeof isRestrictionActive>[0]>) {
  return {
    type: PostingRestrictionType.TEMPORARY,
    startsAt: at(-HOUR),
    expiresAt: at(HOUR),
    liftedAt: null,
    ...overrides,
  };
}

describe("posting restriction rules", () => {
  describe("isRestrictionActive", () => {
    // [WORD-TC: TC-PRR-01]
    // Chức năng: Restriction tạm thời chỉ active trong cửa sổ thời gian
    it("[TC-PRR-01] Restriction tạm thời chỉ active trong cửa sổ thời gian", () => {
      expect(isRestrictionActive(window({}), NOW)).toBe(true);
    });

    // [WORD-TC: TC-PRR-02]
    // Chức năng: Hết hạn: exactly at expiresAt (expiresAt <= now is inactive)
    it("[TC-PRR-02] Hết hạn: exactly at expiresAt (expiresAt <= now is inactive)", () => {
      expect(isRestrictionActive(window({ expiresAt: NOW }), NOW)).toBe(false);
      expect(isRestrictionActive(window({ expiresAt: at(-1) }), NOW)).toBe(
        false,
      );
      expect(isRestrictionActive(window({ expiresAt: at(1) }), NOW)).toBe(true);
    });

    // [WORD-TC: TC-PRR-03]
    // Chức năng: startsAt tương lai chưa active; startsAt == now thì active
    it("[TC-PRR-03] startsAt tương lai chưa active; startsAt == now thì active", () => {
      expect(isRestrictionActive(window({ startsAt: at(1) }), NOW)).toBe(false);
      expect(isRestrictionActive(window({ startsAt: NOW }), NOW)).toBe(true);
    });

    // [WORD-TC: TC-PRR-04]
    // Chức năng: Ban vĩnh viễn active cho tới khi được gỡ (lift)
    it("[TC-PRR-04] Ban vĩnh viễn active cho tới khi được gỡ (lift)", () => {
      const ban = window({
        type: PostingRestrictionType.PERMANENT,
        expiresAt: null,
      });
      expect(isRestrictionActive(ban, NOW)).toBe(true);
      expect(isRestrictionActive(ban, at(10 * 365 * 24 * HOUR))).toBe(true);
      expect(isRestrictionActive({ ...ban, liftedAt: NOW }, NOW)).toBe(false);
    });

    // [WORD-TC: TC-PRR-05]
    // Chức năng: Restriction tạm thời đã lift thì inactive kể cả trong cửa sổ
    it("[TC-PRR-05] Restriction tạm thời đã lift thì inactive kể cả trong cửa sổ", () => {
      expect(isRestrictionActive(window({ liftedAt: at(-1) }), NOW)).toBe(
        false,
      );
    });
  });

  describe("assertValidRestrictionWindow", () => {
    // [WORD-TC: TC-PRR-06]
    // Chức năng: Chấp nhận: a temporary window and a permanent ban
    it("[TC-PRR-06] Chấp nhận: a temporary window and a permanent ban", () => {
      expect(
        assertValidRestrictionWindow(
          PostingRestrictionType.TEMPORARY,
          NOW,
          at(HOUR),
          NOW,
        ),
      ).toEqual({
        type: PostingRestrictionType.TEMPORARY,
        startsAt: NOW,
        expiresAt: at(HOUR),
      });
      expect(
        assertValidRestrictionWindow(
          PostingRestrictionType.PERMANENT,
          NOW,
          undefined,
          NOW,
        ).expiresAt,
      ).toBeNull();
    });

    // [WORD-TC: TC-PRR-07]
    // Chức năng: Cho phép: a future startsAt
    it("[TC-PRR-07] Cho phép: a future startsAt", () => {
      expect(
        assertValidRestrictionWindow(
          PostingRestrictionType.TEMPORARY,
          at(HOUR),
          at(2 * HOUR),
          NOW,
        ).startsAt,
      ).toEqual(at(HOUR));
    });

    // [WORD-TC: TC-PRR-08]
    // Chức năng: Từ chối: missing expiresAt
    // [WORD-TC: TC-PRR-09]
    // Chức năng: Từ chối: expiresAt == startsAt
    // [WORD-TC: TC-PRR-10]
    // Chức năng: Từ chối: expiresAt < startsAt
    // [WORD-TC: TC-PRR-11]
    // Chức năng: Từ chối: expiresAt in the past (with past startsAt)
    // [WORD-TC: TC-PRR-12]
    // Chức năng: Từ chối: expiresAt == now (with past startsAt)
    // [WORD-TC: TC-PRR-13]
    // Chức năng: Từ chối: permanent with expiresAt
    // [WORD-TC: TC-PRR-14]
    // Chức năng: Từ chối: unknown type
    // [WORD-TC: TC-PRR-15]
    // Chức năng: Từ chối: invalid startsAt
    // [WORD-TC: TC-PRR-16]
    // Chức năng: Từ chối: invalid expiresAt
    it.each([
      ["missing expiresAt", PostingRestrictionType.TEMPORARY, NOW, null],
      ["expiresAt == startsAt", PostingRestrictionType.TEMPORARY, NOW, NOW],
      ["expiresAt < startsAt", PostingRestrictionType.TEMPORARY, NOW, at(-1)],
      [
        "expiresAt in the past (with past startsAt)",
        PostingRestrictionType.TEMPORARY,
        at(-2 * HOUR),
        at(-HOUR),
      ],
      [
        "expiresAt == now (with past startsAt)",
        PostingRestrictionType.TEMPORARY,
        at(-HOUR),
        NOW,
      ],
      [
        "permanent with expiresAt",
        PostingRestrictionType.PERMANENT,
        NOW,
        at(HOUR),
      ],
      ["unknown type", "WARNING", NOW, null],
      [
        "invalid startsAt",
        PostingRestrictionType.PERMANENT,
        new Date("x"),
        null,
      ],
      [
        "invalid expiresAt",
        PostingRestrictionType.TEMPORARY,
        NOW,
        new Date("x"),
      ],
    ])("[TC-PRR] Từ chối cấu hình thời gian hạn chế không hợp lệ: %s", (_label, type, startsAt, expiresAt) => {
      expect(() =>
        assertValidRestrictionWindow(type, startsAt, expiresAt, NOW),
      ).toThrow(BadRequestException);
    });
  });

  describe("mostSevereRestriction / POSTING_RESTRICTED payload", () => {
    const temp = (hours: number, reason: string) => ({
      ...window({ expiresAt: at(hours * HOUR) }),
      reason,
    });

    // [WORD-TC: TC-PRR-17]
    // Chức năng: Trả về: null when nothing is active
    it("[TC-PRR-17] Trả về: null when nothing is active", () => {
      expect(mostSevereRestriction([])).toBeNull();
    });

    // [WORD-TC: TC-PRR-18]
    // Chức năng: Ưu tiên: a permanent ban, otherwise the latest expiry
    it("[TC-PRR-18] Ưu tiên: a permanent ban, otherwise the latest expiry", () => {
      const ban = {
        ...window({ type: PostingRestrictionType.PERMANENT, expiresAt: null }),
        reason: "ban",
      };
      expect(mostSevereRestriction([temp(1, "a"), temp(5, "b")])?.reason).toBe(
        "b",
      );
      expect(
        mostSevereRestriction([temp(1, "a"), ban, temp(9, "c")])?.reason,
      ).toBe("ban");
    });

    // [WORD-TC: TC-PRR-19]
    // Chức năng: Tạo: a 403 with code, type, reason and ISO expiresAt
    it("[TC-PRR-19] Tạo: a 403 with code, type, reason and ISO expiresAt", () => {
      const error = postingRestrictedException(temp(2, "spam"));
      expect(error).toBeInstanceOf(ForbiddenException);
      expect(error.getStatus()).toBe(403);
      expect(error.getResponse()).toEqual({
        statusCode: 403,
        code: "POSTING_RESTRICTED",
        message: "You are currently restricted from creating posts",
        restriction: {
          type: "TEMPORARY",
          reason: "spam",
          expiresAt: at(2 * HOUR).toISOString(),
        },
      });
      const permanent = postingRestrictedException({
        ...window({ type: PostingRestrictionType.PERMANENT, expiresAt: null }),
        reason: "fraud",
      });
      expect(
        (permanent.getResponse() as { restriction: { expiresAt: unknown } })
          .restriction.expiresAt,
      ).toBeNull();
    });
  });
});

describe("restriction boundaries (Phase 1 corrective)", () => {
  // All instants are UTC; `+07:00` cases prove comparison is by instant.
  const utc = (hhmm: string) => new Date(`2026-11-01T${hhmm}:00.000Z`);
  const now = utc("10:00");
  const temp = (startsAt: Date, expiresAt: Date) => () =>
    assertValidRestrictionWindow(
      PostingRestrictionType.TEMPORARY,
      startsAt,
      expiresAt,
      now,
    );

  // [WORD-TC: TC-PRR-20]
  // Chức năng: Từ chối: now 10:00, startsAt 08:00, expiresAt 09:00 (already expired)
  it("[TC-PRR-20] Từ chối: now 10:00, startsAt 08:00, expiresAt 09:00 (already expired)", () => {
    expect(temp(utc("08:00"), utc("09:00"))).toThrow(
      "expiresAt must be in the future",
    );
  });

  // [WORD-TC: TC-PRR-21]
  // Chức năng: Từ chối: expiresAt == now
  it("[TC-PRR-21] Từ chối: expiresAt == now", () => {
    expect(temp(utc("08:00"), now)).toThrow("expiresAt must be in the future");
  });

  // [WORD-TC: TC-PRR-22]
  // Chức năng: Từ chối: expiresAt < startsAt and expiresAt == startsAt
  it("[TC-PRR-22] Từ chối: expiresAt < startsAt and expiresAt == startsAt", () => {
    expect(temp(utc("12:00"), utc("11:00"))).toThrow(
      "expiresAt must be later than startsAt",
    );
    expect(temp(utc("11:00"), utc("11:00"))).toThrow(
      "expiresAt must be later than startsAt",
    );
  });

  // [WORD-TC: TC-PRR-23]
  // Chức năng: Chấp nhận: expiresAt later than both now and startsAt
  it("[TC-PRR-23] Chấp nhận: expiresAt later than both now and startsAt", () => {
    expect(temp(utc("08:00"), new Date(now.getTime() + 1))()).toMatchObject({
      expiresAt: new Date(now.getTime() + 1),
    });
    expect(temp(now, utc("11:00"))()).toMatchObject({ startsAt: now });
  });

  // [WORD-TC: TC-PRR-24]
  // Chức năng: Chấp nhận: a future startsAt with a later expiresAt
  it("[TC-PRR-24] Chấp nhận: a future startsAt with a later expiresAt", () => {
    expect(temp(utc("12:00"), utc("13:00"))()).toEqual({
      type: PostingRestrictionType.TEMPORARY,
      startsAt: utc("12:00"),
      expiresAt: utc("13:00"),
    });
  });

  // [WORD-TC: TC-PRR-25]
  // Chức năng: Loại PERMANENT bắt buộc expiresAt = null
  it("[TC-PRR-25] Loại PERMANENT bắt buộc expiresAt = null", () => {
    expect(
      assertValidRestrictionWindow(
        PostingRestrictionType.PERMANENT,
        now,
        null,
        now,
      ),
    ).toEqual({
      type: PostingRestrictionType.PERMANENT,
      startsAt: now,
      expiresAt: null,
    });
    expect(() =>
      assertValidRestrictionWindow(
        PostingRestrictionType.PERMANENT,
        now,
        utc("11:00"),
        now,
      ),
    ).toThrow("must not have expiresAt");
  });

  // [WORD-TC: TC-PRR-26]
  // Chức năng: Active khi now == startsAt; inactive khi now == expiresAt
  it("[TC-PRR-26] Active khi now == startsAt; inactive khi now == expiresAt", () => {
    const window = {
      type: PostingRestrictionType.TEMPORARY,
      startsAt: utc("10:00"),
      expiresAt: utc("11:00"),
      liftedAt: null,
    };
    expect(isRestrictionActive(window, utc("10:00"))).toBe(true);
    expect(isRestrictionActive(window, utc("11:00"))).toBe(false);
    expect(
      isRestrictionActive(window, new Date(utc("11:00").getTime() - 1)),
    ).toBe(true);
  });

  // [WORD-TC: TC-PRR-27]
  // Chức năng: So sánh theo thời điểm tuyệt đối, không theo chuỗi (múi giờ tương đương)
  it("[TC-PRR-27] So sánh theo thời điểm tuyệt đối, không theo chuỗi (múi giờ tương đương)", () => {
    const window = {
      type: PostingRestrictionType.TEMPORARY,
      startsAt: new Date("2026-11-01T17:00:00+07:00"), // 10:00Z
      expiresAt: new Date("2026-11-01T18:00:00+07:00"), // 11:00Z
      liftedAt: null,
    };
    expect(isRestrictionActive(window, utc("10:00"))).toBe(true);
    expect(isRestrictionActive(window, utc("11:00"))).toBe(false);
    expect(
      temp(
        new Date("2026-11-01T15:00:00+07:00"),
        new Date("2026-11-01T16:00:00+07:00"),
      ),
    ).toThrow("expiresAt must be in the future");
  });
});
