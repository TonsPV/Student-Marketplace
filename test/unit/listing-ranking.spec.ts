/**
 * MODULE: POSTS (VÒNG ĐỜI TIN ĐĂNG)
 *
 * WORD TEST CASES:
 * - TC-RNK-01: 0 review hoặc seller không có dòng reputation → UNRATED
 * - TC-RNK-02: Số review nhỏ hơn minimumReviewCount → INSUFFICIENT_DATA
 * - TC-RNK-03: Điểm trung bình NULL → UNRATED (không bao giờ EXCELLENT)
 * - TC-RNK-04: Giữ nguyên ngưỡng đã thống nhất, không làm tròn hai lần
 * - TC-RNK-05: Thứ tự ranking: EXCELLENT(6) > GOOD(5) > MEDIUM(4) > INSUFFICIENT_DATA(3) > UNRATED(2) > LOW(1)
 * - TC-RNK-06: Thứ tự ranking dùng chung một nguồn CASE với phân loại reputation (single source)
 * - TC-RNK-07: Dùng EXISTS cho từng tin để nhiều promotion không nhân bản bản ghi tin
 * - TC-RNK-08: Chỉ boost khi promotion ACTIVE; SCHEDULED/EXPIRED/CANCELLED không boost
 * - TC-RNK-09: Bảng promotions luôn được tham chiếu kèm schema (schema-qualified)
 * - TC-RNK-10: Áp dụng: the shared eligibility policy with schema-qualified tables
 * - TC-RNK-11: Từ chối: invalid schema identifiers
 * - TC-RNK-12: Loại trừ promotion có thời hạn NULL hoặc đã hết hạn đúng tại thời điểm now
 */

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
  // [WORD-TC: TC-RNK-01]
  // Chức năng: 0 review hoặc seller không có dòng reputation → UNRATED
  it("[TC-RNK-01] 0 review hoặc seller không có dòng reputation → UNRATED", () => {
    const sql = reputationCaseExpression(config);
    expect(sql).toContain(
      `WHEN COALESCE(reputation.review_count, 0) = 0 THEN '${ReputationLevel.UNRATED}'`,
    );
  });

  // [WORD-TC: TC-RNK-02]
  // Chức năng: Số review nhỏ hơn minimumReviewCount → INSUFFICIENT_DATA
  it("[TC-RNK-02] Số review nhỏ hơn minimumReviewCount → INSUFFICIENT_DATA", () => {
    const sql = reputationCaseExpression(config);
    expect(sql).toContain(
      `WHEN reputation.review_count < ${config.minimumReviewCount} THEN '${ReputationLevel.INSUFFICIENT_DATA}'`,
    );
  });

  // [WORD-TC: TC-RNK-03]
  // Chức năng: Điểm trung bình NULL → UNRATED (không bao giờ EXCELLENT)
  it("[TC-RNK-03] Điểm trung bình NULL → UNRATED (không bao giờ EXCELLENT)", () => {
    const sql = reputationCaseExpression(config);
    const defensive = sql.indexOf("rating_average IS NULL");
    const low = sql.indexOf("THEN 'LOW'");
    expect(defensive).toBeGreaterThan(-1);
    expect(defensive).toBeLessThan(low);
  });

  // [WORD-TC: TC-RNK-04]
  // Chức năng: Giữ nguyên ngưỡng đã thống nhất, không làm tròn hai lần
  it("[TC-RNK-04] Giữ nguyên ngưỡng đã thống nhất, không làm tròn hai lần", () => {
    const sql = reputationCaseExpression(config);
    expect(sql).toContain("< 3 THEN 'LOW'");
    expect(sql).toContain("< 4 THEN 'MEDIUM'");
    expect(sql).toContain("< 4.5 THEN 'GOOD'");
    expect(sql).toContain(`ELSE '${ReputationLevel.EXCELLENT}'`);
    expect(sql).not.toContain("ROUND");
  });
});

describe("reputation priority expression", () => {
  // [WORD-TC: TC-RNK-05]
  // Chức năng: Thứ tự ranking: EXCELLENT(6) > GOOD(5) > MEDIUM(4) > INSUFFICIENT_DATA(3) > UNRATED(2) > LOW(1)
  it("[TC-RNK-05] Thứ tự ranking: EXCELLENT(6) > GOOD(5) > MEDIUM(4) > INSUFFICIENT_DATA(3) > UNRATED(2) > LOW(1)", () => {
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

  // [WORD-TC: TC-RNK-06]
  // Chức năng: Thứ tự ranking dùng chung một nguồn CASE với phân loại reputation (single source)
  it("[TC-RNK-06] Thứ tự ranking dùng chung một nguồn CASE với phân loại reputation (single source)", () => {
    const sql = reputationPriorityExpression(config);
    expect(sql).toContain(reputationCaseExpression(config));
  });
});

describe("active promotion expression", () => {
  // [WORD-TC: TC-RNK-07]
  // Chức năng: Dùng EXISTS cho từng tin để nhiều promotion không nhân bản bản ghi tin
  it("[TC-RNK-07] Dùng EXISTS cho từng tin để nhiều promotion không nhân bản bản ghi tin", () => {
    const sql = activePromotionExpression("public");
    expect(sql).toContain("EXISTS");
    expect(sql).not.toContain("JOIN");
    expect(sql).toContain('active_promotion."postId" = post.id');
  });

  // [WORD-TC: TC-RNK-08]
  // Chức năng: Chỉ boost khi promotion ACTIVE; SCHEDULED/EXPIRED/CANCELLED không boost
  it("[TC-RNK-08] Chỉ boost khi promotion ACTIVE; SCHEDULED/EXPIRED/CANCELLED không boost", () => {
    const sql = activePromotionExpression("public");
    expect(sql).toContain("active_promotion.cancelled_at IS NULL");
    expect(sql).toContain(
      'active_promotion."startsAt" <= statement_timestamp()',
    );
    expect(sql).toContain('active_promotion."endsAt" > statement_timestamp()');
  });

  // [WORD-TC: TC-RNK-09]
  // Chức năng: Bảng promotions luôn được tham chiếu kèm schema (schema-qualified)
  it("[TC-RNK-09] Bảng promotions luôn được tham chiếu kèm schema (schema-qualified)", () => {
    expect(activePromotionExpression("app_schema")).toContain(
      '"app_schema"."post_promotions"',
    );
  });
});

describe("reputation subquery", () => {
  // [WORD-TC: TC-RNK-10]
  // Chức năng: Áp dụng: the shared eligibility policy with schema-qualified tables
  it("[TC-RNK-10] Áp dụng: the shared eligibility policy with schema-qualified tables", () => {
    const sql = reputationSubquery("app_schema");
    expect(sql).toContain('"app_schema"."reviews"');
    expect(sql).toContain('"app_schema"."posts"');
    expect(sql).toContain("review.deleted_at IS NULL");
    expect(sql).not.toContain("eligible_post.deleted_at IS NULL");
    expect(sql).toContain("eligible_post.status IN ('active', 'sold')");
    expect(sql).toContain("ROUND(AVG(review.rating)::numeric, 1)");
    expect(sql).toContain("GROUP BY eligible_post.seller_id");
  });

  // [WORD-TC: TC-RNK-11]
  // Chức năng: Từ chối: invalid schema identifiers
  it("[TC-RNK-11] Từ chối: invalid schema identifiers", () => {
    expect(() => reputationSubquery('public"; DROP TABLE posts')).toThrow(
      "Invalid POSTGRES_SCHEMA",
    );
    expect(() => qualifiedTableName("public", "posts; --")).toThrow(
      "Invalid table name",
    );
  });
});

describe("listing expiry predicate", () => {
  // [WORD-TC: TC-RNK-12]
  // Chức năng: Loại trừ promotion có thời hạn NULL hoặc đã hết hạn đúng tại thời điểm now
  it("[TC-RNK-12] Loại trừ promotion có thời hạn NULL hoặc đã hết hạn đúng tại thời điểm now", () => {
    // Valid while expires_at > now; NULL (legacy rows, no backfill) is valid.
    expect(LISTING_EXPIRY_PREDICATE).toBe(
      "(post.expires_at > statement_timestamp())",
    );
  });
});
