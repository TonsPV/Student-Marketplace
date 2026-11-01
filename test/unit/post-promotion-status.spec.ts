import {
  PostPromotionEntity,
  PromotionStatus,
  promotionStatus,
} from "../../src/modules/posts/post-promotion.entity";

const NOW = new Date("2026-06-15T12:00:00.000Z");
const minute = 60_000;

function promotion(
  overrides: Partial<
    Pick<PostPromotionEntity, "startsAt" | "endsAt" | "cancelledAt">
  > = {},
) {
  return {
    startsAt: new Date(NOW.getTime() - 10 * minute),
    endsAt: new Date(NOW.getTime() + 10 * minute),
    cancelledAt: null,
    ...overrides,
  };
}

describe("promotion lifecycle is derived from timestamps", () => {
  it("ACTIVE while startsAt <= now < endsAt and not cancelled", () => {
    expect(promotionStatus(promotion(), NOW)).toBe(PromotionStatus.ACTIVE);
    // Boundary: exactly at starts_at is already active.
    expect(
      promotionStatus(promotion({ startsAt: NOW }), NOW),
    ).toBe(PromotionStatus.ACTIVE);
  });

  it("SCHEDULED before startsAt — never boosted by ranking", () => {
    expect(
      promotionStatus(
        promotion({ startsAt: new Date(NOW.getTime() + minute) }),
        NOW,
      ),
    ).toBe(PromotionStatus.SCHEDULED);
  });

  it("EXPIRED once endsAt <= now — never boosted by ranking", () => {
    expect(
      promotionStatus(
        promotion({ endsAt: new Date(NOW.getTime() - minute) }),
        NOW,
      ),
    ).toBe(PromotionStatus.EXPIRED);
    // Boundary: exactly at ends_at is already expired.
    expect(promotionStatus(promotion({ endsAt: NOW }), NOW)).toBe(
      PromotionStatus.EXPIRED,
    );
  });

  it("CANCELLED overrides the window, past or future", () => {
    expect(
      promotionStatus(promotion({ cancelledAt: NOW }), NOW),
    ).toBe(PromotionStatus.CANCELLED);
    expect(
      promotionStatus(
        promotion({
          startsAt: new Date(NOW.getTime() + minute),
          cancelledAt: NOW,
        }),
        NOW,
      ),
    ).toBe(PromotionStatus.CANCELLED);
  });
});
