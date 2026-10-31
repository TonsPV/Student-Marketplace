import { DataSource, Raw } from "typeorm";
import { PostEntity, PostStatus } from "../posts/post.entity";
import { ReviewEntity } from "./review.entity";

/** Match the review scope of ReviewsService.findBySeller. */
export async function sellerStatistics(
  dataSource: DataSource,
  sellerId: string,
) {
  const [reviews, activeCount, soldCount] = await Promise.all([
    dataSource
      .getRepository(ReviewEntity)
      .createQueryBuilder("review")
      .innerJoin("review.post", "post")
      .where("post.sellerId = :sellerId", { sellerId })
      .select("AVG(review.rating)", "ratingAverage")
      .addSelect("COUNT(review.id)", "reviewCount")
      .getRawOne<{ ratingAverage: string | null; reviewCount: string }>(),
    dataSource
      .getRepository(PostEntity)
      .countBy({
        sellerId,
        status: PostStatus.ACTIVE,
        expiresAt: Raw((alias) => `${alias} > statement_timestamp()`),
      }),
    dataSource
      .getRepository(PostEntity)
      .countBy({ sellerId, status: PostStatus.SOLD }),
  ]);
  return {
    ratingAverage:
      reviews?.ratingAverage == null ? null : Number(reviews.ratingAverage),
    reviewCount: Number(reviews?.reviewCount ?? 0),
    activeCount,
    soldCount,
  };
}
