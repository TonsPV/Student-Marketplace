import type { UserEntity } from "../user/user.entity";
import type { UserWarningEntity } from "./user-warning.entity";
import type { PostingRestrictionEntity } from "./posting-restriction.entity";
import { restrictionStatus } from "./posting-restriction.rules";
import type {
  ModerationUserSummary,
  RestrictionResponse,
  WarningResponse,
} from "./dto/moderation-response.dto";

/**
 * D5: a user appears only as { id, fullName }. Relations are loaded with
 * withDeleted(), and FK RESTRICT prevents hard deletes, so the row exists;
 * the id fallback only guards against a query that forgot the join.
 */
function summary(
  user: UserEntity | null | undefined,
  id: string,
): ModerationUserSummary {
  return { id: user?.id ?? id, fullName: user?.fullName ?? "" };
}

const iso = (value: Date | null): string | null =>
  value ? value.toISOString() : null;

export function toWarningResponse(row: UserWarningEntity): WarningResponse {
  return {
    id: row.id,
    userId: row.userId,
    user: summary(row.user, row.userId),
    reason: row.reason,
    sourceReportId: row.sourceReportId,
    issuedBy: summary(row.issuedBy, row.issuedById),
    createdAt: row.createdAt.toISOString(),
  };
}

/** `now` is taken once per request so filter and status always agree. */
export function toRestrictionResponse(
  row: PostingRestrictionEntity,
  now: Date,
): RestrictionResponse {
  return {
    id: row.id,
    userId: row.userId,
    user: summary(row.user, row.userId),
    type: row.type,
    reason: row.reason,
    startsAt: row.startsAt.toISOString(),
    expiresAt: iso(row.expiresAt),
    status: restrictionStatus(row, now),
    issuedBy: summary(row.issuedBy, row.issuedById),
    sourceReportId: row.sourceReportId,
    createdAt: row.createdAt.toISOString(),
    liftedAt: iso(row.liftedAt),
    liftedBy: row.liftedById ? summary(row.liftedBy, row.liftedById) : null,
    liftReason: row.liftReason,
  };
}
