/**
 * MODULE: MODERATION & POSTING RESTRICTIONS
 *
 * WORD TEST CASES:
 * - TC-RPP-01: Đánh giá đúng ngưỡng với 2 review, tổng điểm 2
 * - TC-RPP-02: Đánh giá đúng ngưỡng với 3 review, tổng điểm 3
 * - TC-RPP-03: Đánh giá đúng ngưỡng với 3 review, tổng điểm 5
 * - TC-RPP-04: Đánh giá đúng ngưỡng với 3 review, tổng điểm 6
 * - TC-RPP-05: Đánh giá đúng ngưỡng với 4 review, tổng điểm 6
 * - TC-RPP-06: Đánh giá đúng ngưỡng với 20 review, tổng điểm 29
 * - TC-RPP-07: Từ chối: invalid rating null before persistence
 * - TC-RPP-08: Từ chối: invalid rating 0 before persistence
 * - TC-RPP-09: Từ chối: invalid rating 6 before persistence
 * - TC-RPP-10: Từ chối: invalid rating 1.2 before persistence
 * - TC-RPP-11: Từ chối: invalid rating 5 before persistence
 * - TC-RPP-12: Chấp nhận thiếu rating, rating hợp lệ và xóa comment
 */

import { reputationPostingDecision } from "../../src/modules/moderation/reputation-posting-policy";
import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { UpdateReviewDto } from "../../src/modules/reviews/dto/update-review.dto";

describe("automatic reputation policy and review input", () => {
  // [WORD-TC: TC-RPP-01]
  // Chức năng: Đánh giá đúng ngưỡng với 2 review, tổng điểm 2
  // [WORD-TC: TC-RPP-02]
  // Chức năng: Đánh giá đúng ngưỡng với 3 review, tổng điểm 3
  // [WORD-TC: TC-RPP-03]
  // Chức năng: Đánh giá đúng ngưỡng với 3 review, tổng điểm 5
  // [WORD-TC: TC-RPP-04]
  // Chức năng: Đánh giá đúng ngưỡng với 3 review, tổng điểm 6
  // [WORD-TC: TC-RPP-05]
  // Chức năng: Đánh giá đúng ngưỡng với 4 review, tổng điểm 6
  // [WORD-TC: TC-RPP-06]
  // Chức năng: Đánh giá đúng ngưỡng với 20 review, tổng điểm 29
  it.each([
    [2, 2, false, false],
    [3, 3, true, true],
    [3, 5, true, false],
    [3, 6, false, false],
    [4, 6, true, false],
    [20, 29, true, true],
  ])(
    "[TC-RPP] Đánh giá chính xác ngưỡng cảnh báo/chặn cho %i đánh giá với tổng điểm %i",
    (count, total, warning, blocked) => {
      expect(reputationPostingDecision(count, total)).toMatchObject({
        warning,
        blocked,
      });
    },
  );
  // [WORD-TC: TC-RPP-07]
  // Chức năng: Từ chối: invalid rating null before persistence
  // [WORD-TC: TC-RPP-08]
  // Chức năng: Từ chối: invalid rating 0 before persistence
  // [WORD-TC: TC-RPP-09]
  // Chức năng: Từ chối: invalid rating 6 before persistence
  // [WORD-TC: TC-RPP-10]
  // Chức năng: Từ chối: invalid rating 1.2 before persistence
  // [WORD-TC: TC-RPP-11]
  // Chức năng: Từ chối: invalid rating 5 before persistence
  it.each([null, 0, 6, 1.2, "5"])(
    "[TC-RPP] Từ chối điểm đánh giá không hợp lệ %s trước khi lưu",
    async (rating) => {
      expect(
        (await validate(plainToInstance(UpdateReviewDto, { rating }))).some(
          (e) => e.property === "rating",
        ),
      ).toBe(true);
    },
  );
  // [WORD-TC: TC-RPP-12]
  // Chức năng: Chấp nhận thiếu rating, rating hợp lệ và xóa comment
  it("[TC-RPP-12] Chấp nhận thiếu rating, rating hợp lệ và xóa comment", async () => {
    for (const payload of [
      { comment: null },
      { rating: 5 },
      { comment: "Updated" },
    ])
      expect(await validate(plainToInstance(UpdateReviewDto, payload))).toEqual(
        [],
      );
  });
});
