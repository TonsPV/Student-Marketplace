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
    // Read the live database clock after acquiring locks: transaction-start time
    // can precede the deadline even when activation happens after expiry.
    const [clock] = await m.query("SELECT clock_timestamp() AS now");
    const now = new Date(clock.now);
    if (
      !(post.expiresAt instanceof Date) ||
      !Number.isFinite(post.expiresAt.getTime()) ||
      post.expiresAt <= now
    )
      return {
        eligible: false,
        reason: "post_expired",
        promotedUntil: null,
      };
    const user = await m.findOneBy(UserEntity, { id: owner, isLocked: false });
    if (!user)
      return {
        eligible: false,
        reason: "account_unavailable",
        promotedUntil: null,
      };
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
