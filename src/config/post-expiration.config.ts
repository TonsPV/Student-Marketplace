export type PostExpirationConfig = {
  /** Số ngày một bài đăng còn hiển thị kể từ khi đăng/khôi phục. */
  durationDays: number;
};

/** Legacy date helper. Activations use PostLifecycleService and the agreed 14-day policy. */
const DEFAULT_POST_EXPIRATION_CONFIG: PostExpirationConfig = {
  durationDays: 14,
};

function parseNumber(raw: string | undefined, key: string, fallback: number) {
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid env variable: ${key} must be a finite number`);
  }
  return value;
}

export function postExpirationConfig(
  env: Record<string, string | undefined> = process.env,
): PostExpirationConfig {
  const durationDays = parseNumber(
    env.POST_EXPIRATION_DAYS,
    "POST_EXPIRATION_DAYS",
    DEFAULT_POST_EXPIRATION_CONFIG.durationDays,
  );
  if (
    !Number.isInteger(durationDays) ||
    durationDays < 1 ||
    durationDays > 365
  ) {
    throw new Error("Invalid POST_EXPIRATION_DAYS: must be an integer 1..365");
  }
  return { durationDays };
}

/**
 * Quy ước hiệu lực: bài còn hiển thị khi `expiresAt > now`;
 * bài hết hạn khi `expiresAt <= now`. PostLifecycle owns non-null deadlines.
 */
export function postExpiresAt(
  now: Date,
  config: PostExpirationConfig = postExpirationConfig(),
): Date {
  return new Date(now.getTime() + config.durationDays * 24 * 60 * 60 * 1000);
}
