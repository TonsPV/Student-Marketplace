import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { AuthorizationService } from "../authorization/authorization.service";
import type { AuthenticatedContext } from "../authorization/authorization.types";
import { PostEntity, PostStatus } from "./post.entity";
import {
  PostPromotionEntity,
  PromotionStatus,
  promotionStatus,
} from "./post-promotion.entity";
import { CreatePostPromotionDto } from "./dto/post-promotion.dto";

/**
 * Admin-managed promotion data source for Unified Ranking (Phase 4 Step 2).
 * Actors: admins only (CASL subject "PostPromotion", admin-only policy —
 * mirrors defineModerationRules). Sellers cannot self-promote; there is no
 * payment flow in this scope. Rules enforced here:
 *   - only ACTIVE, not soft-deleted, not expired posts can be promoted;
 *   - endsAt must be strictly after startsAt and in the future;
 *   - no overlapping non-cancelled window for the same post;
 *   - expired promotions can never be re-activated (no status column);
 *   - cancelling stamps cancelledAt/cancelledBy and is irreversible.
 */
@Injectable()
export class PostPromotionsService {
  constructor(
    @InjectRepository(PostPromotionEntity)
    private readonly promotionsRepository: Repository<PostPromotionEntity>,
    @InjectRepository(PostEntity)
    private readonly postsRepository: Repository<PostEntity>,
    private readonly authorization: AuthorizationService,
  ) {}

  async adminCreate(
    context: AuthenticatedContext,
    postId: string,
    dto: CreatePostPromotionDto,
  ) {
    this.authorization.assertRoute(context, "create", "PostPromotion");
    const post = await this.postsRepository.findOne({
      where: { id: postId },
      withDeleted: true,
    });
    if (!post || post.deletedAt) throw new NotFoundException("Post not found");
    if (post.status !== PostStatus.ACTIVE) {
      throw new BadRequestException(
        "Promotions can only target active posts",
      );
    }
    const now = new Date();
    if (post.expiresAt && post.expiresAt.getTime() <= now.getTime()) {
      throw new BadRequestException("Expired posts cannot be promoted");
    }
    const startsAt = dto.startsAt ? new Date(dto.startsAt) : now;
    const endsAt = new Date(dto.endsAt);
    if (endsAt.getTime() <= startsAt.getTime()) {
      throw new BadRequestException("endsAt must be after startsAt");
    }
    if (endsAt.getTime() <= now.getTime()) {
      throw new BadRequestException("endsAt must be in the future");
    }
    const overlapping = await this.promotionsRepository
      .createQueryBuilder("promotion")
      .where("promotion.postId = :postId", { postId })
      .andWhere("promotion.cancelledAt IS NULL")
      .andWhere("promotion.endsAt > :startsAt", { startsAt })
      .andWhere("promotion.startsAt < :endsAt", { endsAt })
      .getExists();
    if (overlapping) {
      throw new ConflictException(
        "An active or scheduled promotion already overlaps this window",
      );
    }
    this.authorization.assertCreate(context, "PostPromotion", { postId });
    const promotion = await this.promotionsRepository.save(
      this.promotionsRepository.create({
        postId,
        startsAt,
        endsAt,
        createdById: context.principal.id,
        cancelledAt: null,
        cancelledById: null,
      }),
    );
    return this.toResponse(promotion, now);
  }

  async adminList(
    context: AuthenticatedContext,
    postId: string,
  ) {
    this.authorization.assertRoute(context, "read", "PostPromotion");
    const items = await this.promotionsRepository.find({
      where: { postId },
      order: { startsAt: "DESC" },
    });
    const now = new Date();
    return items.map((promotion) => this.toResponse(promotion, now));
  }

  async adminCancel(
    context: AuthenticatedContext,
    postId: string,
    promotionId: string,
  ) {
    this.authorization.assertRoute(context, "cancel", "PostPromotion");
    const promotion = await this.promotionsRepository.findOne({
      where: { id: promotionId, postId },
    });
    if (!promotion) throw new NotFoundException("Promotion not found");
    if (promotion.cancelledAt) {
      throw new ConflictException("Promotion already cancelled");
    }
    const now = new Date();
    if (promotionStatus(promotion, now) === PromotionStatus.EXPIRED) {
      throw new ConflictException("Promotion already expired");
    }
    promotion.cancelledAt = now;
    promotion.cancelledById = context.principal.id;
    return this.toResponse(
      await this.promotionsRepository.save(promotion),
      now,
    );
  }

  private toResponse(promotion: PostPromotionEntity, now: Date) {
    return {
      id: promotion.id,
      postId: promotion.postId,
      startsAt: promotion.startsAt.toISOString(),
      endsAt: promotion.endsAt.toISOString(),
      cancelledAt: promotion.cancelledAt?.toISOString() ?? null,
      cancelledById: promotion.cancelledById,
      createdAt: promotion.createdAt.toISOString(),
      status: promotionStatus(promotion, now),
    };
  }
}
