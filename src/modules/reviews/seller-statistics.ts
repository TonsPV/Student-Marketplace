import { DataSource } from "typeorm";
import { reputationConfig } from "../../config/reputation.config";
import { PostEntity, PostStatus } from "../posts/post.entity";
import { ReviewEntity } from "./review.entity";
import { ReputationLevel } from "./reputation-level";

export function calculateReputationLevel(
  reviewCount: number,
  ratingAverage: number | null,
  config = reputationConfig(),
): ReputationLevel {
  if (reviewCount === 0) return ReputationLevel.UNRATED;
  if (reviewCount < config.minimumReviewCount) {
    return ReputationLevel.INSUFFICIENT_DATA;
  }
  if (ratingAverage === null) {
    throw new Error("Rating average is required when reviews exist");
  }
  if (ratingAverage < config.lowAverageThreshold) return ReputationLevel.LOW;
  if (ratingAverage < config.goodAverageThreshold)
    return ReputationLevel.MEDIUM;
  if (ratingAverage < config.excellentAverageThreshold)
    return ReputationLevel.GOOD;
  return ReputationLevel.EXCELLENT;
}

export function roundRatingAverage(value: number): number {
  const [whole, fraction = ""] = value.toString().split(".");
  const tenth = Number(fraction.padEnd(2, "0")[0]);
  const shouldRoundUp = Number(fraction.padEnd(2, "0")[1]) >= 5;
  const roundedTenths = Number(whole) * 10 + tenth + (shouldRoundUp ? 1 : 0);
  return roundedTenths / 10;
}

/** Apply the shared eligibility policy for seller reputation aggregates. */
export async function sellerStatistics(
  dataSource: DataSource,
  sellerId: string,
) {
  const [reviews, activeCount, soldCount] = await Promise.all([
    dataSource
      .getRepository(ReviewEntity)
      .createQueryBuilder("review")
      .innerJoin(
        PostEntity,
        "post",
        "post.id = review.post_id AND post.seller_id = :sellerId",
        { sellerId },
      )
      .where("review.deleted_at IS NULL")
      .andWhere("post.deleted_at IS NULL")
      .andWhere("post.status IN (:...statuses)", {
        statuses: [PostStatus.ACTIVE, PostStatus.SOLD],
      })
      .select("ROUND(AVG(review.rating)::numeric, 1)", "ratingAverage")
      .addSelect("COUNT(review.id)", "reviewCount")
      .getRawOne<{ ratingAverage: string | null; reviewCount: string }>(),
    dataSource
      .getRepository(PostEntity)
      .countBy({ sellerId, status: PostStatus.ACTIVE }),
    dataSource
      .getRepository(PostEntity)
      .countBy({ sellerId, status: PostStatus.SOLD }),
  ]);
  const ratingAverage =
    reviews?.ratingAverage == null ? null : Number(reviews.ratingAverage);
  const reviewCount = Number(reviews?.reviewCount ?? 0);
  const config = reputationConfig();
  return {
    ratingAverage,
    reviewCount,
    reputationLevel: calculateReputationLevel(
      reviewCount,
      ratingAverage,
      config,
    ),
    activeCount,
    soldCount,
  };
}
