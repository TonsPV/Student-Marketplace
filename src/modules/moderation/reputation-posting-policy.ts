import { EntityManager } from "typeorm";
import { ReviewEntity } from "../reviews/review.entity";
import { PostEntity, PostStatus } from "../posts/post.entity";

export function reputationPostingDecision(
  reviewCount: number,
  ratingTotal: number,
) {
  const warning = reviewCount >= 3 && ratingTotal < 2 * reviewCount;
  const blocked = reviewCount >= 3 && 2 * ratingTotal < 3 * reviewCount;
  return {
    reviewCount,
    ratingAverage: reviewCount ? ratingTotal / reviewCount : null,
    warning,
    blocked,
    reason: blocked
      ? "Điểm đánh giá dưới 1,5 sao (từ 3 đánh giá). Bạn được đăng lại khi điểm cải thiện."
      : warning
        ? "Điểm đánh giá dưới 2 sao (từ 3 đánh giá). Hãy cải thiện chất lượng giao dịch."
        : null,
  };
}

export async function sellerPostingReputation(
  manager: EntityManager,
  sellerId: string,
) {
  const row = await manager
    .getRepository(ReviewEntity)
    .createQueryBuilder("review")
    .withDeleted()
    .innerJoin(
      PostEntity,
      "post",
      "post.id = review.postId AND post.sellerId = :sellerId",
      { sellerId },
    )
    .where("review.deletedAt IS NULL")
    .andWhere("post.status IN (:...statuses)", {
      statuses: [PostStatus.ACTIVE, PostStatus.SOLD],
    })
    .select("COUNT(review.id)", "count")
    .addSelect("COALESCE(SUM(review.rating), 0)", "total")
    .getRawOne<{ count: string; total: string }>();
  // Use the exact total, not the display average rounded to one decimal.
  return reputationPostingDecision(
    Number(row?.count ?? 0),
    Number(row?.total ?? 0),
  );
}
