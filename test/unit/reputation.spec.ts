import { reputationConfig } from "../../src/config/reputation.config";
import {
  calculateReputationLevel,
  roundRatingAverage,
} from "../../src/modules/reviews/seller-statistics";
import { ReputationLevel } from "../../src/modules/reviews/reputation-level";

const config = reputationConfig({});

test("uses UNRATED and INSUFFICIENT_DATA before the minimum count", () => {
  expect(calculateReputationLevel(0, null, config)).toBe(
    ReputationLevel.UNRATED,
  );
  expect(calculateReputationLevel(2, 5, config)).toBe(
    ReputationLevel.INSUFFICIENT_DATA,
  );
});

test("rounds HALF_UP before classifying eligible averages", () => {
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

test("supports validated environment configuration", () => {
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
