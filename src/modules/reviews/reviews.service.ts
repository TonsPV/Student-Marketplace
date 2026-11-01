import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, In, QueryFailedError, Repository } from "typeorm";
import { createPaginationMeta } from "../../common/utils/pagination.util";
import { PostEntity, PostStatus } from "../posts/post.entity";
import { UserEntity } from "../user/user.entity";
import { CreateReviewDto } from "./dto/create-review.dto";
import { FindReviewsDto } from "./dto/find-reviews.dto";
import { UpdateReviewDto } from "./dto/update-review.dto";
import { ReviewEntity } from "./review.entity";
import { ReviewEditHistoryEntity } from "./review-edit-history.entity";
import { AuthorizationService } from "../authorization/authorization.service";
import type {
  AuthenticatedContext,
  AuthorizationContext,
} from "../authorization/authorization.types";
import { toReviewProjection } from "../authorization/subject-projections";

const PG_UNIQUE_VIOLATION = "23505";

@Injectable()
export class ReviewsService {
  constructor(
    @InjectRepository(ReviewEntity)
    private readonly reviewsRepository: Repository<ReviewEntity>,
    @InjectRepository(PostEntity)
    private readonly postsRepository: Repository<PostEntity>,
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
    private readonly authorization: AuthorizationService,
  ) {}

  async create(dto: CreateReviewDto, context: AuthenticatedContext) {
    const post = await this.postsRepository.findOneBy({ id: dto.postId });
    if (!post) {
      throw new NotFoundException("Post not found");
    }

    if (
      post.status !== PostStatus.SOLD ||
      post.buyerId !== context.principal.id
    ) {
      throw new ForbiddenException(
        "Only the confirmed buyer can review a sold post",
      );
    }
    if (
      !post.soldAt ||
      Date.now() > post.soldAt.getTime() + 30 * 24 * 60 * 60 * 1000
    ) {
      throw new ForbiddenException("The review period has expired");
    }
    if (post.sellerId === context.principal.id) {
      throw new ForbiddenException("You cannot review your own post");
    }

    this.authorization.assertCreate(context, "Review", {
      reviewerId: context.principal.id,
      postId: post.id,
    });

    const review = this.reviewsRepository.create({
      reviewerId: context.principal.id,
      postId: post.id,
      rating: dto.rating,
      comment: dto.comment ?? null,
    });

    try {
      const savedReview = await this.reviewsRepository.save(review);
      return this.withEditMetadata(savedReview, null);
    } catch (error) {
      const driverError =
        error instanceof QueryFailedError
          ? (error.driverError as { code?: string; constraint?: string })
          : undefined;

      if (
        driverError?.code === PG_UNIQUE_VIOLATION &&
        ["uq_reviews_post_id", "uq_reviews_reviewer_post"].includes(
          driverError.constraint ?? "",
        )
      ) {
        throw new ConflictException("You have already reviewed this post");
      }

      throw error;
    }
  }

  async findOne(id: string, context: AuthorizationContext) {
    const review = await this.reviewsRepository
      .createQueryBuilder("review")
      .innerJoin("review.post", "post")
      .leftJoin("review.reviewer", "reviewer")
      .where("review.id = :id", { id })
      .andWhere("review.deleted_at IS NULL")
      .andWhere("post.deleted_at IS NULL")
      .andWhere("post.status IN (:...statuses)", {
        statuses: [PostStatus.ACTIVE, PostStatus.SOLD],
      })
      .select([
        "review.id",
        "review.reviewerId",
        "review.postId",
        "review.rating",
        "review.comment",
        "review.createdAt",
        "review.updatedAt",
        "reviewer.id",
        "reviewer.fullName",
        "reviewer.avatarUrl",
        "post.id",
        "post.title",
        "post.sellerId",
      ])
      .getOne();

    if (!review) {
      throw new NotFoundException("Review not found");
    }
    {
      this.authorization.assertResource(
        context,
        "read",
        "Review",
        toReviewProjection({
          id: review.id,
          reviewerId: review.reviewerId,
          postId: review.postId,
        }) as unknown as Record<string, unknown>,
      );
    }

    const [response] = await this.withEditMetadata([review]);
    return response;
  }

  async findHistory(id: string, context: AuthenticatedContext) {
    if (context.kind !== "authenticated") {
      throw new ForbiddenException("Authentication required");
    }

    const review = await this.reviewsRepository.findOne({
      where: { id },
      withDeleted: true,
    });
    if (!review) {
      throw new NotFoundException("Review not found");
    }
    if (
      !context.principal.isAdmin &&
      review.reviewerId.toLowerCase() !== context.principal.id.toLowerCase()
    ) {
      throw new ForbiddenException("Forbidden");
    }

    const histories = await this.reviewsRepository.manager
      .getRepository(ReviewEditHistoryEntity)
      .find({
        where: { reviewId: review.id },
        order: { revision: "ASC" },
      });

    return histories.map((history) => ({
      id: history.id,
      reviewId: history.reviewId,
      editorId: history.editorId,
      oldRating: history.oldRating,
      newRating: history.newRating,
      oldComment: history.oldComment,
      newComment: history.newComment,
      revision: history.revision,
      editedAt: history.editedAt,
    }));
  }

  async findByPost(
    postId: string,
    query: FindReviewsDto,
    context: AuthorizationContext,
  ) {
    const post = await this.postsRepository.findOne({
      where: {
        id: postId,
        status: In([PostStatus.ACTIVE, PostStatus.SOLD]),
      },
    });
    if (!post) {
      throw new NotFoundException("Post not found");
    }
    this.authorization.assertRoute(context, "read", "Review");

    const { page, limit } = query;
    const [items, total] = await this.reviewsRepository.findAndCount({
      where: { postId },
      relations: { reviewer: true },
      select: {
        reviewer: {
          id: true,
          fullName: true,
          avatarUrl: true,
        },
      },
      order: { createdAt: "DESC" },
      skip: (page - 1) * limit,
      take: limit,
    });
    const responseItems = await this.withEditMetadata(items);

    return {
      items: responseItems,
      meta: createPaginationMeta(query, total),
    };
  }

  async findBySeller(
    sellerId: string,
    query: FindReviewsDto,
    context: AuthorizationContext,
  ) {
    const seller = await this.usersRepository.findOneBy({ id: sellerId });
    if (!seller) {
      throw new NotFoundException("Seller not found");
    }
    this.authorization.assertRoute(context, "read", "Review");

    const { page, limit } = query;
    const queryBuilder = this.reviewsRepository
      .createQueryBuilder("review")
      .innerJoin("review.post", "post")
      .leftJoin("review.reviewer", "reviewer")
      .addSelect(["reviewer.id", "reviewer.fullName", "reviewer.avatarUrl"])
      .where("post.sellerId = :sellerId", { sellerId })
      .andWhere("review.deleted_at IS NULL")
      .andWhere("post.deleted_at IS NULL")
      .andWhere("post.status IN (:...statuses)", {
        statuses: [PostStatus.ACTIVE, PostStatus.SOLD],
      })
      .orderBy("review.createdAt", "DESC")
      .skip((page - 1) * limit)
      .take(limit);

    const [items, total] = await queryBuilder.getManyAndCount();
    const responseItems = await this.withEditMetadata(items);

    return {
      items: responseItems,
      meta: createPaginationMeta(query, total),
    };
  }

  async update(
    id: string,
    dto: UpdateReviewDto,
    context: AuthenticatedContext,
  ) {
    const patch: Record<string, unknown> = { ...dto };

    const result = await this.reviewsRepository.manager.transaction(
      async (manager) => {
        const review = await this.lockReview(manager, id);
        if (!review || review.deletedAt) {
          throw new NotFoundException("Review not found");
        }
        const projection = toReviewProjection({
          id: review.id,
          reviewerId: review.reviewerId,
          postId: review.postId,
        }) as unknown as Record<string, unknown>;
        this.authorization.assertUpdateFields(
          context,
          "update",
          "Review",
          projection,
          patch,
        );
        const effective = this.authorization.effectivePatch(patch);
        if (Object.keys(effective).length === 0) {
          throw new BadRequestException(
            "At least one review field must be provided",
          );
        }

        const oldRating = review.rating;
        const oldComment = review.comment;
        const nextRating =
          effective.rating === undefined
            ? oldRating
            : (effective.rating as number);
        const nextComment =
          effective.comment === undefined
            ? oldComment
            : (effective.comment as string | null);
        if (nextRating === oldRating && nextComment === oldComment) {
          const [latestHistory] = await this.historiesForReviews(manager, [
            review.id,
          ]);
          return { review, latestHistory: latestHistory ?? null };
        }

        review.rating = nextRating;
        review.comment = nextComment;
        const updatedReview = await manager
          .getRepository(ReviewEntity)
          .save(review);
        const revision = await this.nextRevision(manager, review.id);
        const history = await manager
          .getRepository(ReviewEditHistoryEntity)
          .save(
            manager.getRepository(ReviewEditHistoryEntity).create({
              reviewId: review.id,
              editorId: context.principal.id,
              oldRating,
              newRating: nextRating,
              oldComment,
              newComment: nextComment,
              revision,
            }),
          );
        return { review: updatedReview, latestHistory: history };
      },
    );
    return this.withEditMetadata(result.review, result.latestHistory);
  }

  async remove(id: string, context: AuthenticatedContext) {
    await this.reviewsRepository.manager.transaction(async (manager) => {
      const review = await this.lockReview(manager, id);
      if (!review || review.deletedAt) {
        throw new NotFoundException("Review not found");
      }
      this.authorization.assertResource(
        context,
        "delete",
        "Review",
        toReviewProjection({
          id: review.id,
          reviewerId: review.reviewerId,
          postId: review.postId,
        }) as unknown as Record<string, unknown>,
      );
      await manager.getRepository(ReviewEntity).softRemove(review);
    });
  }

  private async lockReview(
    manager: EntityManager,
    id: string,
  ): Promise<ReviewEntity | null> {
    return manager
      .getRepository(ReviewEntity)
      .createQueryBuilder("review")
      .where("review.id = :id", { id })
      .setLock("pessimistic_write")
      .withDeleted()
      .getOne();
  }

  private async nextRevision(
    manager: EntityManager,
    reviewId: string,
  ): Promise<number> {
    const latest = await manager
      .getRepository(ReviewEditHistoryEntity)
      .findOne({
        where: { reviewId },
        order: { revision: "DESC" },
      });
    return (latest?.revision ?? 0) + 1;
  }

  private async historiesForReviews(
    manager: EntityManager,
    reviewIds: string[],
  ): Promise<ReviewEditHistoryEntity[]> {
    if (reviewIds.length === 0) return [];
    return manager.getRepository(ReviewEditHistoryEntity).find({
      where: { reviewId: In(reviewIds) },
      order: { revision: "DESC" },
    });
  }

  private async withEditMetadata(
    review: ReviewEntity,
    latestHistory: ReviewEditHistoryEntity | null,
  ): Promise<ReviewEntity & { isEdited: boolean; editedAt: Date | null }>;
  private async withEditMetadata(
    reviews: ReviewEntity[],
  ): Promise<
    Array<ReviewEntity & { isEdited: boolean; editedAt: Date | null }>
  >;
  private async withEditMetadata(
    reviewOrReviews: ReviewEntity | ReviewEntity[],
    latestHistory?: ReviewEditHistoryEntity | null,
  ) {
    const reviews = Array.isArray(reviewOrReviews)
      ? reviewOrReviews
      : [reviewOrReviews];
    const histories =
      latestHistory === undefined
        ? await this.historiesForReviews(
            this.reviewsRepository.manager,
            reviews.map((review) => review.id),
          )
        : latestHistory
          ? [latestHistory]
          : [];
    const latestByReviewId = new Map<string, ReviewEditHistoryEntity>();
    for (const history of histories) {
      if (!latestByReviewId.has(history.reviewId)) {
        latestByReviewId.set(history.reviewId, history);
      }
    }
    const response = reviews.map((review) => {
      const history = latestByReviewId.get(review.id);
      return {
        ...review,
        isEdited: history !== undefined,
        editedAt: history?.editedAt ?? null,
      };
    });
    return Array.isArray(reviewOrReviews) ? response : response[0];
  }
}
