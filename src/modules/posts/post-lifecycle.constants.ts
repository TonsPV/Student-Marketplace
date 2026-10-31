export const POST_QUOTA = 5;
export const POST_LIFETIME_DAYS = 14;
export const POST_REMINDER_DAYS = 3;
export const DAY_MS = 24 * 60 * 60 * 1000;

// SQL helpers are shared with reputation/ranking. Apply before count/pagination.
// Alias is supplied by server code only, never by an HTTP parameter.
export function visiblePostSql(alias: string): string {
  return `(${alias}.status = 'active' AND ${alias}.deleted_at IS NULL AND ${alias}.expires_at > statement_timestamp())`;
}

export function publicPostSql(alias: string): string {
  return `(${alias}.deleted_at IS NULL AND (${alias}.status = 'sold' OR ${visiblePostSql(alias)}))`;
}
