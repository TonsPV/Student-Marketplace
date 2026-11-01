import {
  activePromotionExpression,
  LISTING_EXPIRY_PREDICATE,
  qualifiedTableName,
  reputationCaseExpression,
  reputationPriorityExpression,
  reputationSubquery,
} from "../../src/modules/posts/listing-ranking";
import { ReputationLevel } from "../../src/modules/reviews/reputation-level";

const config = {
  minimumReviewCount: 3,
  lowAverageThreshold: 3,
  mediumAverageThreshold: 3,
  goodAverageThreshold: 4,
  excellentAverageThreshold: 4.5,
};

describe("reputation CASE expression (unified ranking policy)", () => {
  it("classifies 0 reviews and sellers without a reputation row as UNRATED", () => {
    const sql = reputationCaseExpression(config);
    expect(sql).toContain(
      `WHEN COALESCE(reputation.review_count, 0) = 0 THEN '${ReputationLevel.UNRATED}'`,
    );
  });

  it("classifies fewer than minimumReviewCount reviews as INSUFFICIENT_DATA", () => {
    const sql = reputationCaseExpression(config);
    expect(sql).toContain(
      `WHEN reputation.review_count < ${config.minimumReviewCount} THEN '${ReputationLevel.INSUFFICIENT_DATA}'`,
    );
  });

  it("defensively returns UNRATED (never EXCELLENT) for a NULL average", () => {
    const sql = reputationCaseExpression(config);
    const defensive = sql.indexOf("rating_average IS NULL");
    const low = sql.indexOf("THEN 'LOW'");
    expect(defensive).toBeGreaterThan(-1);
    expect(defensive).toBeLessThan(low);
  });

  it("keeps the agreed thresholds and does not double-round", () => {
    const sql = reputationCaseExpression(config);
    expect(sql).toContain("< 3 THEN 'LOW'");
    expect(sql).toContain("< 4 THEN 'MEDIUM'");
    expect(sql).toContain("< 4.5 THEN 'GOOD'");
    expect(sql).toContain(`ELSE '${ReputationLevel.EXCELLENT}'`);
    expect(sql).not.toContain("ROUND");
  });
});

describe("reputation priority expression", () => {
  it("ranks EXCELLENT(6) > GOOD(5) > MEDIUM(4) > INSUFFICIENT_DATA(3) > UNRATED(2) > LOW(1)", () => {
    const sql = reputationPriorityExpression(config);
    expect(sql).toContain("WHEN 'EXCELLENT' THEN 6");
    expect(sql).toContain("WHEN 'GOOD' THEN 5");
    expect(sql).toContain("WHEN 'MEDIUM' THEN 4");
    expect(sql).toContain("WHEN 'INSUFFICIENT_DATA' THEN 3");
    expect(sql).toContain("WHEN 'UNRATED' THEN 2");
    expect(sql).toContain("WHEN 'LOW' THEN 1");
    // LOW is intentionally the last eligible level — never above UNRATED
    // (asserted on the outer priority mapping branches, in order).
    expect(
      /WHEN 'INSUFFICIENT_DATA' THEN 3[\s\S]*WHEN 'UNRATED' THEN 2[\s\S]*WHEN 'LOW' THEN 1/.test(
        sql,
      ),
    ).toBe(true);
  });

  it("is derived from the same CASE as the classification (single source)", () => {
    const sql = reputationPriorityExpression(config);
    expect(sql).toContain(reputationCaseExpression(config));
  });
});

describe("active promotion expression", () => {
  it("uses EXISTS per post so multiple promotions never duplicate a post", () => {
    const sql = activePromotionExpression("public");
    expect(sql).toContain("EXISTS");
    expect(sql).not.toContain("JOIN");
    expect(sql).toContain("active_promotion.post_id = post.id");
  });

  it("only boosts the ACTIVE window (not scheduled, expired or cancelled)", () => {
    const sql = activePromotionExpression("public");
    expect(sql).toContain("active_promotion.cancelled_at IS NULL");
    expect(sql).toContain("active_promotion.starts_at <= :listingNow");
    expect(sql).toContain("active_promotion.ends_at > :listingNow");
  });

  it("schema-qualifies the promotions table", () => {
    expect(activePromotionExpression("app_schema")).toContain(
      '"app_schema"."post_promotions"',
    );
  });
});

describe("reputation subquery", () => {
  it("applies the shared eligibility policy with schema-qualified tables", () => {
    const sql = reputationSubquery("app_schema");
    expect(sql).toContain('"app_schema"."reviews"');
    expect(sql).toContain('"app_schema"."posts"');
    expect(sql).toContain("review.deleted_at IS NULL");
    expect(sql).toContain("eligible_post.deleted_at IS NULL");
    expect(sql).toContain("eligible_post.status IN ('active', 'sold')");
    expect(sql).toContain("ROUND(AVG(review.rating)::numeric, 1)");
    expect(sql).toContain("GROUP BY eligible_post.seller_id");
  });

  it("rejects invalid schema identifiers", () => {
    expect(() => reputationSubquery('public"; DROP TABLE posts')).toThrow(
      "Invalid POSTGRES_SCHEMA",
    );
    expect(() => qualifiedTableName("public", "posts; --")).toThrow(
      "Invalid table name",
    );
  });
});

describe("listing expiry predicate", () => {
  it("treats NULL lifetime as valid and expired-at-now as excluded", () => {
    // Valid while expires_at > now; NULL (legacy rows, no backfill) is valid.
    expect(LISTING_EXPIRY_PREDICATE).toBe(
      "(post.expires_at IS NULL OR post.expires_at > :listingNow)",
    );
  });
});
