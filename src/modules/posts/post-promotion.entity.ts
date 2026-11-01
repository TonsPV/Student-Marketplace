import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { BaseEntity } from "../../common/entities/base.entity";
import { PostEntity } from "./post.entity";
import { UserEntity } from "../user/user.entity";

/**
 * Promotion lifecycle is DERIVED from timestamps, not stored:
 *   CANCELLED  — cancelled_at IS NOT NULL
 *   SCHEDULED  — starts_at > now (and not cancelled)
 *   ACTIVE     — starts_at <= now < ends_at (and not cancelled)
 *   EXPIRED    — ends_at <= now (and not cancelled)
 * The active window used by ranking matches these boundaries exactly.
 */
export enum PromotionStatus {
  SCHEDULED = "SCHEDULED",
  ACTIVE = "ACTIVE",
  EXPIRED = "EXPIRED",
  CANCELLED = "CANCELLED",
}

@Entity("post_promotions")
@Index("idx_post_promotions_post_id", ["postId"])
export class PostPromotionEntity extends BaseEntity {
  @Column({ name: "post_id", type: "uuid" })
  postId!: string;

  @ManyToOne(() => PostEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "post_id" })
  post!: PostEntity;

  @Column({ name: "starts_at", type: "timestamptz" })
  startsAt!: Date;

  @Column({ name: "ends_at", type: "timestamptz" })
  endsAt!: Date;

  @Column({ name: "created_by_id", type: "uuid" })
  createdById!: string;

  @ManyToOne(() => UserEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "created_by_id" })
  createdBy!: UserEntity;

  @Column({ name: "cancelled_at", type: "timestamptz", nullable: true })
  cancelledAt!: Date | null;

  @Column({ name: "cancelled_by_id", type: "uuid", nullable: true })
  cancelledById!: string | null;

  @ManyToOne(() => UserEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "cancelled_by_id" })
  cancelledBy!: UserEntity | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}

export function promotionStatus(
  promotion: Pick<PostPromotionEntity, "startsAt" | "endsAt" | "cancelledAt">,
  now: Date,
): PromotionStatus {
  if (promotion.cancelledAt !== null) return PromotionStatus.CANCELLED;
  if (promotion.startsAt.getTime() > now.getTime())
    return PromotionStatus.SCHEDULED;
  if (promotion.endsAt.getTime() <= now.getTime())
    return PromotionStatus.EXPIRED;
  return PromotionStatus.ACTIVE;
}
