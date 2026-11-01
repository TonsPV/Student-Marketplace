import { Promotion as PostPromotionEntity } from "../promotions/promotion.entity";
export { Promotion as PostPromotionEntity } from "../promotions/promotion.entity";

/**
 * Promotion lifecycle is DERIVED from timestamps, not stored:
 *   CANCELLED  — cancelled_at IS NOT NULL
 *   SCHEDULED  — starts_at > now (and not cancelled)
 *   ACTIVE     — starts_at <= now < ends_at (and not cancelled)
 *   EXPIRED    — ends_at <= now (and not cancelled)
 * The active window used by ranking matches these boundaries exactly.
 */
export enum PromotionStatus {
  SCHEDULED = "SCHEDULED",
  ACTIVE = "ACTIVE",
  EXPIRED = "EXPIRED",
  CANCELLED = "CANCELLED",
}

export function promotionStatus(
  promotion: Pick<PostPromotionEntity, "startsAt" | "endsAt" | "cancelledAt">,
  now: Date,
): PromotionStatus {
  if (promotion.cancelledAt !== null) return PromotionStatus.CANCELLED;
  if (promotion.startsAt.getTime() > now.getTime())
    return PromotionStatus.SCHEDULED;
  if (promotion.endsAt.getTime() <= now.getTime())
    return PromotionStatus.EXPIRED;
  return PromotionStatus.ACTIVE;
}
