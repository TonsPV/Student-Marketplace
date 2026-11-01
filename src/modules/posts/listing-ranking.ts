import { reputationConfig } from "../../config/reputation.config";
import { ReputationLevel } from "../reviews/reputation-level";

/**
 * Pure SQL building blocks for the unified listing ranking (Phase 4).
 * Kept out of PostsService so the ranking policy is unit-testable and there
 * is exactly one place generating each expression.
 *
 * Reputation classification MUST stay identical to
 * `calculateReputationLevel` (src/modules/reviews/seller-statistics.ts):
 *   0 reviews -> UNRATED; < minimumReviewCount -> INSUFFICIENT_DATA;
 *   otherwise by the (already SQL-rounded) average against thresholds.
 */

/** Validate + quote a table name with its schema (consistent with search). */
export function qualifiedTableName(schema: string, table: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(schema)) {
    throw new Error("Invalid POSTGRES_SCHEMA");
  }
  if (!/^[a-z][a-z0-9_]*$/.test(table)) {
    throw new Error(`Invalid table name: ${table}`);
  }
  return `"${schema}"."${table}"`;
}

export function reputationSubquery(schema: string): string {
  const posts = qualifiedTableName(schema, "posts");
  const reviews = qualifiedTableName(schema, "reviews");
  return `(SELECT eligible_post.seller_id,
                   COUNT(review.id)::int AS review_count,
                   ROUND(AVG(review.rating)::numeric, 1) AS rating_average
              FROM ${reviews} review
             INNER JOIN ${posts} eligible_post
                ON eligible_post.id = review.post_id
             WHERE review.deleted_at IS NULL
               AND eligible_post.deleted_at IS NULL
               AND eligible_post.status IN ('active', 'sold')
             GROUP BY eligible_post.seller_id)`;
}

export function reputationCaseExpression(
  config = reputationConfig(),
): string {
  return `CASE
              WHEN COALESCE(reputation.review_count, 0) = 0 THEN '${ReputationLevel.UNRATED}'
              WHEN reputation.review_count < ${config.minimumReviewCount} THEN '${ReputationLevel.INSUFFICIENT_DATA}'
              WHEN reputation.rating_average IS NULL THEN '${ReputationLevel.UNRATED}'
              WHEN reputation.rating_average < ${config.lowAverageThreshold} THEN '${ReputationLevel.LOW}'
              WHEN reputation.rating_average < ${config.goodAverageThreshold} THEN '${ReputationLevel.MEDIUM}'
              WHEN reputation.rating_average < ${config.excellentAverageThreshold} THEN '${ReputationLevel.GOOD}'
              ELSE '${ReputationLevel.EXCELLENT}'
            END`;
}

export function reputationPriorityExpression(
  config = reputationConfig(),
): string {
  return `CASE (${reputationCaseExpression(config)}) WHEN '${ReputationLevel.EXCELLENT}' THEN 6
              WHEN '${ReputationLevel.GOOD}' THEN 5
              WHEN '${ReputationLevel.MEDIUM}' THEN 4
              WHEN '${ReputationLevel.INSUFFICIENT_DATA}' THEN 3
              WHEN '${ReputationLevel.UNRATED}' THEN 2
              WHEN '${ReputationLevel.LOW}' THEN 1
              ELSE 0 END`;
}

/**
 * Active-promotion boost (1/0) per post, evaluated in the database.
 * EXISTS — never a JOIN — so multiple promotion records of one post cannot
 * duplicate the post in results. Active means `starts_at <= now < ends_at`
 * and not cancelled; SCHEDULED/EXPIRED/CANCELLED never boost. Every listing
 * query binds `:listingNow` once per request via the expiry predicate.
 */
export function activePromotionExpression(schema: string): string {
  const promotions = qualifiedTableName(schema, "post_promotions");
  return `CASE WHEN EXISTS (
            SELECT 1 FROM ${promotions} active_promotion
             WHERE active_promotion.post_id = post.id
               AND active_promotion.cancelled_at IS NULL
               AND active_promotion.starts_at <= :listingNow
               AND active_promotion.ends_at > :listingNow
          ) THEN 1 ELSE 0 END`;
}

/** Listing eligibility: a post is visible while `expiresAt > now`. */
export const LISTING_EXPIRY_PREDICATE =
  "(post.expires_at IS NULL OR post.expires_at > :listingNow)";
