import { Injectable } from "@nestjs/common";
import { EntityManager, MoreThan, LessThanOrEqual } from "typeorm";
import { PostEntity, PostStatus } from "../posts/post.entity";
import { UserEntity } from "../user/user.entity";
import { Promotion } from "../promotions/promotion.entity";

@Injectable()
export class PromotionEligibilityService {
  async check(m: EntityManager, post: PostEntity | null, owner: string) {
    if (!post || post.sellerId !== owner || post.deletedAt)
      return {
        eligible: false,
        reason: "not_owner_or_deleted",
        promotedUntil: null,
      };
    if (post.status !== PostStatus.ACTIVE)
      return {
        eligible: false,
        reason: "post_not_active",
        promotedUntil: null,
      };
    const user = await m.findOneBy(UserEntity, { id: owner, isLocked: false });
    if (!user)
      return {
        eligible: false,
        reason: "account_unavailable",
        promotedUntil: null,
      };
    const now = new Date();
    const promotion = await m.findOne(Promotion, {
      where: {
        postId: post.id,
        startsAt: LessThanOrEqual(now),
        endsAt: MoreThan(now),
      },
      order: { endsAt: "DESC" },
    });
    return {
      eligible: !promotion,
      reason: promotion ? "already_promoted" : null,
      promotedUntil: promotion?.endsAt ?? null,
    };
  }
}
