import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
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
import { PaymentOrder } from "../payments/payment.entity";
import { UserEntity } from "../user/user.entity";

/**
 * Admin-managed promotion data source for Unified Ranking (Phase 4 Step 2).
 * Actors: admins only (CASL subject "PostPromotion", admin-only policy —
 * mirrors defineModerationRules). Shares the promotion source with paid
 * seller boosts. Rules enforced here:
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
    return this.postsRepository.manager.transaction(
      "READ COMMITTED",
      async (manager) => {
        const postsRepository = manager.getRepository(PostEntity);
        const promotionsRepository = manager.getRepository(PostPromotionEntity);
        const post = await postsRepository
          .createQueryBuilder("post")
          .withDeleted()
          .setLock("pessimistic_write")
          .where("post.id = :postId", { postId })
          .getOne();
        if (!post || post.deletedAt)
          throw new NotFoundException("Post not found");
        if (
          !(await manager.findOneBy(UserEntity, {
            id: post.sellerId,
            isLocked: false,
          }))
        ) {
          throw new BadRequestException("Seller account is unavailable");
        }
        if (post.status !== PostStatus.ACTIVE) {
          throw new BadRequestException(
            "Promotions can only target active posts",
          );
        }
        const [clock] = await manager.query("SELECT clock_timestamp() AS now");
        const now = new Date(clock.now);
        if (!post.expiresAt || post.expiresAt.getTime() <= now.getTime()) {
          throw new BadRequestException("Expired posts cannot be promoted");
        }
        const startsAt = dto.startsAt ? new Date(dto.startsAt) : now;
        const endsAt = new Date(dto.endsAt);
        if (
          !Number.isFinite(startsAt.getTime()) ||
          !Number.isFinite(endsAt.getTime()) ||
          endsAt.getTime() <= startsAt.getTime()
        ) {
          throw new BadRequestException("endsAt must be after startsAt");
        }
        if (endsAt.getTime() <= now.getTime()) {
          throw new BadRequestException("endsAt must be in the future");
        }
        const overlapping = await promotionsRepository
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
        const promotion = await promotionsRepository.save(
          promotionsRepository.create({
            postId,
            startsAt,
            endsAt,
            createdById: context.principal.id,
            cancelledAt: null,
            cancelledById: null,
          }),
        );
        return this.toResponse(promotion, now);
      },
    );
  }

  async adminList(context: AuthenticatedContext, postId: string) {
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
    return this.postsRepository.manager.transaction(async (manager) => {
      // Serialize all promotion mutations with checkout/activation on this post.
      await manager
        .getRepository(PostEntity)
        .createQueryBuilder("post")
        .withDeleted()
        .where("post.id = :postId", { postId })
        .setLock("pessimistic_write")
        .getOne();
      const promotion = await manager.findOne(PostPromotionEntity, {
        where: { id: promotionId, postId },
        lock: { mode: "pessimistic_write" },
      });
      if (!promotion) throw new NotFoundException("Promotion not found");
      if (promotion.cancelledAt) {
        throw new ConflictException("Promotion already cancelled");
      }
      const [clock] = await manager.query("SELECT clock_timestamp() AS now");
      const now = new Date(clock.now);
      if (promotionStatus(promotion, now) === PromotionStatus.EXPIRED) {
        throw new ConflictException("Promotion already expired");
      }
      promotion.cancelledAt = now;
      promotion.cancelledById = context.principal.id;
      if (promotion.orderId) {
        // Money remains collected. Cancellation requires manual service/financial
        // review; never imply a refund or leave fulfillment marked active.
        await manager.update(
          PaymentOrder,
          { id: promotion.orderId, status: "paid" },
          {
            fulfillment: "requires_review",
            reason: "promotion_cancelled_by_admin",
          },
        );
      }
      return this.toResponse(
        await manager.save(PostPromotionEntity, promotion),
        now,
      );
    });
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
