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
    it("temporary restriction is active inside its window", () => {
      expect(isRestrictionActive(window({}), NOW)).toBe(true);
    });

    it("expires exactly at expiresAt (expiresAt <= now is inactive)", () => {
      expect(isRestrictionActive(window({ expiresAt: NOW }), NOW)).toBe(false);
      expect(isRestrictionActive(window({ expiresAt: at(-1) }), NOW)).toBe(
        false,
      );
      expect(isRestrictionActive(window({ expiresAt: at(1) }), NOW)).toBe(true);
    });

    it("future startsAt is not active yet; startsAt == now is active", () => {
      expect(isRestrictionActive(window({ startsAt: at(1) }), NOW)).toBe(false);
      expect(isRestrictionActive(window({ startsAt: NOW }), NOW)).toBe(true);
    });

    it("permanent ban stays active until lifted", () => {
      const ban = window({
        type: PostingRestrictionType.PERMANENT,
        expiresAt: null,
      });
      expect(isRestrictionActive(ban, NOW)).toBe(true);
      expect(isRestrictionActive(ban, at(10 * 365 * 24 * HOUR))).toBe(true);
      expect(isRestrictionActive({ ...ban, liftedAt: NOW }, NOW)).toBe(false);
    });

    it("lifted temporary restriction is inactive even inside its window", () => {
      expect(isRestrictionActive(window({ liftedAt: at(-1) }), NOW)).toBe(
        false,
      );
    });
  });

  describe("assertValidRestrictionWindow", () => {
    it("accepts a temporary window and a permanent ban", () => {
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

    it("allows a future startsAt", () => {
      expect(
        assertValidRestrictionWindow(
          PostingRestrictionType.TEMPORARY,
          at(HOUR),
          at(2 * HOUR),
          NOW,
        ).startsAt,
      ).toEqual(at(HOUR));
    });

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
    ])("rejects %s", (_label, type, startsAt, expiresAt) => {
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

    it("returns null when nothing is active", () => {
      expect(mostSevereRestriction([])).toBeNull();
    });

    it("prefers a permanent ban, otherwise the latest expiry", () => {
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

    it("builds a 403 with code, type, reason and ISO expiresAt", () => {
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

  it("rejects now 10:00, startsAt 08:00, expiresAt 09:00 (already expired)", () => {
    expect(temp(utc("08:00"), utc("09:00"))).toThrow(
      "expiresAt must be in the future",
    );
  });

  it("rejects expiresAt == now", () => {
    expect(temp(utc("08:00"), now)).toThrow("expiresAt must be in the future");
  });

  it("rejects expiresAt < startsAt and expiresAt == startsAt", () => {
    expect(temp(utc("12:00"), utc("11:00"))).toThrow(
      "expiresAt must be later than startsAt",
    );
    expect(temp(utc("11:00"), utc("11:00"))).toThrow(
      "expiresAt must be later than startsAt",
    );
  });

  it("accepts expiresAt later than both now and startsAt", () => {
    expect(temp(utc("08:00"), new Date(now.getTime() + 1))()).toMatchObject({
      expiresAt: new Date(now.getTime() + 1),
    });
    expect(temp(now, utc("11:00"))()).toMatchObject({ startsAt: now });
  });

  it("accepts a future startsAt with a later expiresAt", () => {
    expect(temp(utc("12:00"), utc("13:00"))()).toEqual({
      type: PostingRestrictionType.TEMPORARY,
      startsAt: utc("12:00"),
      expiresAt: utc("13:00"),
    });
  });

  it("PERMANENT requires expiresAt = null", () => {
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

  it("now == startsAt is active; now == expiresAt is inactive", () => {
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

  it("compares instants, not wall-clock strings (+07:00 == UTC)", () => {
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
