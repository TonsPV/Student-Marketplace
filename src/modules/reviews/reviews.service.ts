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
  ) {}

  async create(dto: CreateReviewDto, reviewerId: string) {
    const post = await this.postsRepository.findOneBy({ id: dto.postId });
    if (!post) {
      throw new NotFoundException("Post not found");
    }

    if (post.sellerId === reviewerId) {
      throw new ForbiddenException("You cannot review your own post");
    }

    const review = this.reviewsRepository.create({
      reviewerId,
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

  async findOne(id: string) {
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

    return review;
  }

  async findByPost(postId: string, query: FindReviewsDto) {
    const post = await this.postsRepository.findOneBy({ id: postId });
    if (!post) {
      throw new NotFoundException("Post not found");
    }

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

  async findBySeller(sellerId: string, query: FindReviewsDto) {
    const seller = await this.usersRepository.findOneBy({ id: sellerId });
    if (!seller) {
      throw new NotFoundException("Seller not found");
    }

    const { page, limit } = query;
    const queryBuilder = this.reviewsRepository
      .createQueryBuilder("review")
      .innerJoin("review.post", "post")
      .leftJoin("review.reviewer", "reviewer")
      .addSelect(["reviewer.id", "reviewer.fullName", "reviewer.avatarUrl"])
      .where("post.sellerId = :sellerId", { sellerId }) // Sửa từ post.seller_id thành post.sellerId
      .orderBy("review.createdAt", "DESC") // Sửa từ review.created_at thành review.createdAt
      .skip((page - 1) * limit)
      .take(limit);

    const [items, total] = await queryBuilder.getManyAndCount();

    return {
      items,
      meta: createPaginationMeta(query, total),
    };
  }

  async update(id: string, dto: UpdateReviewDto, reviewerId: string) {
    const review = await this.getOwnedReview(id, reviewerId);

    if (dto.rating === undefined && dto.comment === undefined) {
      throw new BadRequestException(
        "At least one review field must be provided",
      );
    }

    Object.assign(review, dto);
    return this.reviewsRepository.save(review);
  }

  async remove(id: string, reviewerId: string) {
    const review = await this.getOwnedReview(id, reviewerId);
    await this.reviewsRepository.remove(review);
  }

  private async getOwnedReview(id: string, reviewerId: string) {
    const review = await this.reviewsRepository.findOneBy({ id });
    if (!review) {
      throw new NotFoundException("Review not found");
    }

    if (review.reviewerId !== reviewerId) {
      throw new ForbiddenException("You do not own this review");
    }

    return review;
  }
}
