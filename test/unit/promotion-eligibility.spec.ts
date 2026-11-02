/**
 * MODULE: PAYMENTS & PROMOTIONS
 *
 * WORD TEST CASES:
 * - TC-PEL-01: Từ chối: expiry at database now %+d milliseconds while status is still active
 * - TC-PEL-02: Từ chối: expiry at database now %+d milliseconds while status is still active
 * - TC-PEL-03: Cho phép: an unexpired post and uses the database clock for active promotion checks
 * - TC-PEL-04: Từ chối: invalid or absent deadlines
 */

import { EntityManager } from "typeorm";
import { PromotionEligibilityService } from "../../src/modules/payments/promotion-eligibility.service";
import { PostEntity, PostStatus } from "../../src/modules/posts/post.entity";

describe("promotion expiry eligibility", () => {
  const clock = new Date("2030-01-01T00:00:00Z");
  const service = new PromotionEligibilityService();
  let manager: { query: jest.Mock; findOneBy: jest.Mock; findOne: jest.Mock };
  beforeEach(() => {
    // The application clock intentionally differs from PostgreSQL's clock.
    jest.useFakeTimers().setSystemTime(new Date("2020-01-01T00:00:00Z"));
    manager = {
      query: jest.fn().mockResolvedValue([{ now: clock }]),
      findOneBy: jest.fn().mockResolvedValue({ id: "owner" }),
      findOne: jest.fn().mockResolvedValue(null),
    };
  });
  afterEach(() => jest.useRealTimers());
  const post = (expiresAt: Date) =>
    Object.assign(new PostEntity(), {
      id: "post",
      sellerId: "owner",
      status: PostStatus.ACTIVE,
      deletedAt: null,
      expiresAt,
    });
  // [WORD-TC: TC-PEL-01]
  // Chức năng: Từ chối: expiry at database now %+d milliseconds while status is still active
  // [WORD-TC: TC-PEL-02]
  // Chức năng: Từ chối: expiry at database now %+d milliseconds while status is still active
  it.each([-1, 0])(
    "[TC-PEL] Từ chối hạn tin kết thúc tại DB now %+d ms khi tin vẫn active",
    async (offset) => {
      expect(
        await service.check(
          manager as unknown as EntityManager,
          post(new Date(clock.getTime() + offset)),
          "owner",
        ),
      ).toMatchObject({ eligible: false, reason: "post_expired" });
      expect(manager.query).toHaveBeenCalledWith(
        "SELECT clock_timestamp() AS now",
      );
      expect(manager.findOne).not.toHaveBeenCalled();
    },
  );
  // [WORD-TC: TC-PEL-03]
  // Chức năng: Cho phép: an unexpired post and uses the database clock for active promotion checks
  it("[TC-PEL-03] Cho phép: an unexpired post and uses the database clock for active promotion checks", async () => {
    expect(
      await service.check(
        manager as unknown as EntityManager,
        post(new Date(clock.getTime() + 1)),
        "owner",
      ),
    ).toMatchObject({ eligible: true });
    const filters = manager.findOne.mock.calls[0][1].where;
    expect(filters.startsAt.value).toEqual(clock);
    expect(filters.endsAt.value).toEqual(clock);
  });
  // [WORD-TC: TC-PEL-04]
  // Chức năng: Từ chối: invalid or absent deadlines
  it("[TC-PEL-04] Từ chối: invalid or absent deadlines", async () => {
    for (const expiresAt of [new Date(NaN), undefined]) {
      expect(
        await service.check(
          manager as unknown as EntityManager,
          post(expiresAt as Date),
          "owner",
        ),
      ).toMatchObject({ eligible: false, reason: "post_expired" });
    }
  });
});
