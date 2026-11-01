export type ReputationConfig = {
  minimumReviewCount: number;
  lowAverageThreshold: number;
  mediumAverageThreshold: number;
  goodAverageThreshold: number;
  excellentAverageThreshold: number;
};

const DEFAULT_REPUTATION_CONFIG: ReputationConfig = {
  minimumReviewCount: 3,
  lowAverageThreshold: 3,
  mediumAverageThreshold: 3,
  goodAverageThreshold: 4,
  excellentAverageThreshold: 4.5,
};

function parseNumber(raw: string | undefined, key: string, fallback: number) {
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid env variable: ${key} must be a finite number`);
  }
  return value;
}

export function reputationConfig(
  env: Record<string, string | undefined> = process.env,
): ReputationConfig {
  const config = {
    minimumReviewCount: parseNumber(
      env.REPUTATION_MIN_REVIEW_COUNT,
      "REPUTATION_MIN_REVIEW_COUNT",
      DEFAULT_REPUTATION_CONFIG.minimumReviewCount,
    ),
    lowAverageThreshold: parseNumber(
      env.REPUTATION_LOW_AVERAGE,
      "REPUTATION_LOW_AVERAGE",
      DEFAULT_REPUTATION_CONFIG.lowAverageThreshold,
    ),
    mediumAverageThreshold: parseNumber(
      env.REPUTATION_MEDIUM_AVERAGE,
      "REPUTATION_MEDIUM_AVERAGE",
      DEFAULT_REPUTATION_CONFIG.mediumAverageThreshold,
    ),
    goodAverageThreshold: parseNumber(
      env.REPUTATION_GOOD_AVERAGE,
      "REPUTATION_GOOD_AVERAGE",
      DEFAULT_REPUTATION_CONFIG.goodAverageThreshold,
    ),
    excellentAverageThreshold: parseNumber(
      env.REPUTATION_EXCELLENT_AVERAGE,
      "REPUTATION_EXCELLENT_AVERAGE",
      DEFAULT_REPUTATION_CONFIG.excellentAverageThreshold,
    ),
  };
  if (
    !Number.isInteger(config.minimumReviewCount) ||
    config.minimumReviewCount < 1 ||
    config.lowAverageThreshold > config.mediumAverageThreshold ||
    config.mediumAverageThreshold > config.goodAverageThreshold ||
    config.goodAverageThreshold > config.excellentAverageThreshold
  ) {
    throw new Error("Invalid reputation thresholds");
  }
  return config;
}
