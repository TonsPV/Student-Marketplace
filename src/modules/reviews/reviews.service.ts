import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { QueryFailedError, Repository } from "typeorm";
import { createPaginationMeta } from "../../common/utils/pagination.util";
import { PostEntity } from "../posts/post.entity";
import { UserEntity } from "../user/user.entity";
import { CreateReviewDto } from "./dto/create-review.dto";
import { FindReviewsDto } from "./dto/find-reviews.dto";
import { UpdateReviewDto } from "./dto/update-review.dto";
import { ReviewEntity } from "./review.entity";
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
      return await this.reviewsRepository.save(review);
    } catch (error) {
      const driverError =
        error instanceof QueryFailedError
          ? (error.driverError as { code?: string; constraint?: string })
          : undefined;

      if (
        driverError?.code === PG_UNIQUE_VIOLATION &&
        driverError.constraint === "uq_reviews_reviewer_post"
      ) {
        throw new ConflictException("You have already reviewed this post");
      }

      throw error;
    }
  }

  async findOne(id: string, context: AuthorizationContext) {
    const review = await this.reviewsRepository.findOne({
      where: { id },
      relations: { reviewer: true, post: true },
      select: {
        reviewer: {
          id: true,
          fullName: true,
          avatarUrl: true,
        },
        post: {
          id: true,
          title: true,
          sellerId: true,
        },
      },
    });

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

    return review;
  }

  async findByPost(
    postId: string,
    query: FindReviewsDto,
    context: AuthorizationContext,
  ) {
    const post = await this.postsRepository.findOneBy({ id: postId });
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

    return {
      items,
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
      .orderBy("review.createdAt", "DESC")
      .skip((page - 1) * limit)
      .take(limit);

    const [items, total] = await queryBuilder.getManyAndCount();

    return {
      items,
      meta: createPaginationMeta(query, total),
    };
  }

  async update(
    id: string,
    dto: UpdateReviewDto,
    context: AuthenticatedContext,
  ) {
    const review = await this.reviewsRepository.findOneBy({ id });
    if (!review) {
      throw new NotFoundException("Review not found");
    }
    const projection = toReviewProjection({
      id: review.id,
      reviewerId: review.reviewerId,
      postId: review.postId,
    }) as unknown as Record<string, unknown>;
    const patch: Record<string, unknown> = { ...dto };
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
    Object.assign(review, effective);
    return this.reviewsRepository.save(review);
  }

  async remove(id: string, context: AuthenticatedContext) {
    const review = await this.reviewsRepository.findOneBy({ id });
    if (!review) {
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
    await this.reviewsRepository.remove(review);
  }
}
