/**
 * MODULE: REVIEWS (ĐÁNH GIÁ NGƯỜI BÁN)
 *
 * WORD TEST CASES:
 * - TC-REP-01: Trả về UNRATED và INSUFFICIENT_DATA khi chưa đạt số review tối thiểu
 * - TC-REP-02: Làm tròn HALF_UP trước khi phân loại điểm trung bình
 * - TC-REP-03: Hỗ trợ cấu hình từ môi trường và kiểm tra tính hợp lệ
 */

import { reputationConfig } from "../../src/config/reputation.config";
import {
  calculateReputationLevel,
  roundRatingAverage,
} from "../../src/modules/reviews/seller-statistics";
import { ReputationLevel } from "../../src/modules/reviews/reputation-level";

const config = reputationConfig({});

// [WORD-TC: TC-REP-01]
// Chức năng: Trả về UNRATED và INSUFFICIENT_DATA khi chưa đạt số review tối thiểu
test("[TC-REP-01] Trả về UNRATED và INSUFFICIENT_DATA khi chưa đạt số review tối thiểu", () => {
  expect(calculateReputationLevel(0, null, config)).toBe(
    ReputationLevel.UNRATED,
  );
  expect(calculateReputationLevel(2, 5, config)).toBe(
    ReputationLevel.INSUFFICIENT_DATA,
  );
});

// [WORD-TC: TC-REP-02]
// Chức năng: Làm tròn HALF_UP trước khi phân loại điểm trung bình
test("[TC-REP-02] Làm tròn HALF_UP trước khi phân loại điểm trung bình", () => {
  expect(roundRatingAverage(2.94)).toBe(2.9);
  expect(roundRatingAverage(2.95)).toBe(3);
  expect(roundRatingAverage(3.94)).toBe(3.9);
  expect(roundRatingAverage(3.95)).toBe(4);
  expect(roundRatingAverage(4.44)).toBe(4.4);
  expect(roundRatingAverage(4.45)).toBe(4.5);
  expect(roundRatingAverage(4.49)).toBe(4.5);
  expect(roundRatingAverage(4.5)).toBe(4.5);
  expect(calculateReputationLevel(3, 3, config)).toBe(ReputationLevel.MEDIUM);
  expect(calculateReputationLevel(3, 4.5, config)).toBe(
    ReputationLevel.EXCELLENT,
  );
});

// [WORD-TC: TC-REP-03]
// Chức năng: Hỗ trợ cấu hình từ môi trường và kiểm tra tính hợp lệ
test("[TC-REP-03] Hỗ trợ cấu hình từ môi trường và kiểm tra tính hợp lệ", () => {
  expect(
    reputationConfig({
      REPUTATION_MIN_REVIEW_COUNT: "4",
      REPUTATION_LOW_AVERAGE: "2.5",
      REPUTATION_MEDIUM_AVERAGE: "2.5",
      REPUTATION_GOOD_AVERAGE: "3.5",
      REPUTATION_EXCELLENT_AVERAGE: "4.75",
    }),
  ).toEqual({
    minimumReviewCount: 4,
    lowAverageThreshold: 2.5,
    mediumAverageThreshold: 2.5,
    goodAverageThreshold: 3.5,
    excellentAverageThreshold: 4.75,
  });
});
