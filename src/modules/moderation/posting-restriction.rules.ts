import { BadRequestException, ForbiddenException } from "@nestjs/common";

export enum PostingRestrictionType {
  TEMPORARY = "TEMPORARY",
  PERMANENT = "PERMANENT",
}

export interface PostingRestrictionWindow {
  type: PostingRestrictionType;
  startsAt: Date;
  expiresAt: Date | null;
  liftedAt: Date | null;
}

export interface PostingRestrictionSummary extends PostingRestrictionWindow {
  reason: string;
}

/**
 * Single source of truth for "is this restriction in force at `now`".
 * Expiration is evaluated on read, so no cron job or row update is needed:
 * a restriction stops applying exactly at `expiresAt`.
 */
export function isRestrictionActive(
  restriction: PostingRestrictionWindow,
  now: Date,
): boolean {
  if (restriction.liftedAt !== null) return false;
  if (restriction.startsAt.getTime() > now.getTime()) return false;
  if (restriction.expiresAt === null) return true;
  return restriction.expiresAt.getTime() > now.getTime();
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

/**
 * Time-independent checks, safe to run before any lock is taken so malformed
 * input never blocks a user row. The `now`-dependent checks run later in
 * `assertValidRestrictionWindow`, using the clock read after the user lock.
 */
export function assertRestrictionShape(
  type: unknown,
  startsAt: unknown,
  expiresAt: unknown,
): void {
  if (
    type !== PostingRestrictionType.TEMPORARY &&
    type !== PostingRestrictionType.PERMANENT
  ) {
    throw new BadRequestException("Invalid posting restriction type");
  }
  if (startsAt !== undefined && startsAt !== null && !isValidDate(startsAt)) {
    throw new BadRequestException("startsAt must be a valid date");
  }
  if (type === PostingRestrictionType.PERMANENT) {
    if (expiresAt !== null && expiresAt !== undefined) {
      throw new BadRequestException(
        "A permanent posting ban must not have expiresAt",
      );
    }
    return;
  }
  if (!isValidDate(expiresAt)) {
    throw new BadRequestException(
      "A temporary posting restriction requires a valid expiresAt",
    );
  }
}

/** Validates a new restriction window before it is persisted. */
export function assertValidRestrictionWindow(
  type: unknown,
  startsAt: unknown,
  expiresAt: unknown,
  now: Date,
): { type: PostingRestrictionType; startsAt: Date; expiresAt: Date | null } {
  if (
    type !== PostingRestrictionType.TEMPORARY &&
    type !== PostingRestrictionType.PERMANENT
  ) {
    throw new BadRequestException("Invalid posting restriction type");
  }
  if (!isValidDate(startsAt)) {
    throw new BadRequestException("startsAt must be a valid date");
  }
  if (type === PostingRestrictionType.PERMANENT) {
    if (expiresAt !== null && expiresAt !== undefined) {
      throw new BadRequestException(
        "A permanent posting ban must not have expiresAt",
      );
    }
    return { type, startsAt, expiresAt: null };
  }
  if (!isValidDate(expiresAt)) {
    throw new BadRequestException(
      "A temporary posting restriction requires a valid expiresAt",
    );
  }
  if (expiresAt.getTime() <= startsAt.getTime()) {
    throw new BadRequestException("expiresAt must be later than startsAt");
  }
  if (expiresAt.getTime() <= now.getTime()) {
    throw new BadRequestException("expiresAt must be in the future");
  }
  return { type, startsAt, expiresAt };
}

/** Derived on read from startsAt/expiresAt/liftedAt and one `now`. */
export enum RestrictionStatus {
  SCHEDULED = "SCHEDULED",
  ACTIVE = "ACTIVE",
  EXPIRED = "EXPIRED",
  LIFTED = "LIFTED",
}

/**
 * ACTIVE is exactly `isRestrictionActive`. The four states are disjoint and
 * exhaustive because the DB guarantees `expires_at > starts_at`.
 */
export function restrictionStatus(
  restriction: PostingRestrictionWindow,
  now: Date,
): RestrictionStatus {
  if (restriction.liftedAt !== null) return RestrictionStatus.LIFTED;
  if (isRestrictionActive(restriction, now)) return RestrictionStatus.ACTIVE;
  if (restriction.startsAt.getTime() > now.getTime()) {
    return RestrictionStatus.SCHEDULED;
  }
  return RestrictionStatus.EXPIRED;
}

/**
 * SQL form of `restrictionStatus` for QueryBuilder filters, bound to `:now`.
 * ACTIVE matches `getActivePostingRestrictions`; a test keeps both in sync.
 */
export function restrictionStatusSql(
  alias: string,
  status: RestrictionStatus,
): string {
  const lifted = `${alias}.liftedAt`;
  const starts = `${alias}.startsAt`;
  const expires = `${alias}.expiresAt`;
  switch (status) {
    case RestrictionStatus.LIFTED:
      return `${lifted} IS NOT NULL`;
    case RestrictionStatus.SCHEDULED:
      return `(${lifted} IS NULL AND ${starts} > :now)`;
    case RestrictionStatus.ACTIVE:
      return `(${lifted} IS NULL AND ${starts} <= :now AND (${expires} IS NULL OR ${expires} > :now))`;
    case RestrictionStatus.EXPIRED:
      return `(${lifted} IS NULL AND ${expires} IS NOT NULL AND ${expires} <= :now)`;
  }
}

/**
 * Picks the restriction shown to the user: a permanent ban wins, otherwise
 * the temporary restriction that ends last.
 */
export function mostSevereRestriction<T extends PostingRestrictionSummary>(
  restrictions: readonly T[],
): T | null {
  let selected: T | null = null;
  for (const restriction of restrictions) {
    if (!selected) {
      selected = restriction;
      continue;
    }
    if (selected.expiresAt === null) break;
    if (
      restriction.expiresAt === null ||
      restriction.expiresAt.getTime() > selected.expiresAt.getTime()
    ) {
      selected = restriction;
    }
  }
  return selected;
}

export function postingRestrictedException(
  restriction: PostingRestrictionSummary,
): ForbiddenException {
  return new ForbiddenException({
    statusCode: 403,
    code: "POSTING_RESTRICTED",
    message: "You are currently restricted from creating posts",
    restriction: {
      type: restriction.type,
      reason: restriction.reason,
      expiresAt: restriction.expiresAt
        ? restriction.expiresAt.toISOString()
        : null,
    },
  });
}
