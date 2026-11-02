/**
 * MODULE: PAYMENTS & PROMOTIONS
 *
 * WORD TEST CASES:
 * - TC-PST-01: ACTIVE khi startsAt <= now < endsAt và chưa bị hủy
 * - TC-PST-02: Trước startsAt là SCHEDULED và không bao giờ được ranking boost
 * - TC-PST-03: Sau endsAt là EXPIRED và không bao giờ được ranking boost
 * - TC-PST-04: CANCELLED đè lên cửa sổ thời gian (quá khứ hoặc tương lai)
 */

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
  // [WORD-TC: TC-PST-01]
  // Chức năng: ACTIVE khi startsAt <= now < endsAt và chưa bị hủy
  it("[TC-PST-01] ACTIVE khi startsAt <= now < endsAt và chưa bị hủy", () => {
    expect(promotionStatus(promotion(), NOW)).toBe(PromotionStatus.ACTIVE);
    // Boundary: exactly at starts_at is already active.
    expect(
      promotionStatus(promotion({ startsAt: NOW }), NOW),
    ).toBe(PromotionStatus.ACTIVE);
  });

  // [WORD-TC: TC-PST-02]
  // Chức năng: Trước startsAt là SCHEDULED và không bao giờ được ranking boost
  it("[TC-PST-02] Trước startsAt là SCHEDULED và không bao giờ được ranking boost", () => {
    expect(
      promotionStatus(
        promotion({ startsAt: new Date(NOW.getTime() + minute) }),
        NOW,
      ),
    ).toBe(PromotionStatus.SCHEDULED);
  });

  // [WORD-TC: TC-PST-03]
  // Chức năng: Sau endsAt là EXPIRED và không bao giờ được ranking boost
  it("[TC-PST-03] Sau endsAt là EXPIRED và không bao giờ được ranking boost", () => {
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

  // [WORD-TC: TC-PST-04]
  // Chức năng: CANCELLED đè lên cửa sổ thời gian (quá khứ hoặc tương lai)
  it("[TC-PST-04] CANCELLED đè lên cửa sổ thời gian (quá khứ hoặc tương lai)", () => {
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
