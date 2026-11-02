import { PostEntity } from "../posts/post.entity";
import { UserEntity } from "../user/user.entity";
import { PaymentOrder } from "../payments/payment.entity";
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { BaseEntity } from "../../common/entities/base.entity";
@Entity("post_promotions")
@Index(["postId", "endsAt"])
@Check("chk_post_promotions_window", '"endsAt" > "startsAt"')
@Check(
  "chk_post_promotions_source",
  '"orderId" IS NOT NULL OR "created_by_id" IS NOT NULL',
)
@Check(
  "chk_post_promotions_cancel",
  '("cancelled_at" IS NULL AND "cancelled_by_id" IS NULL) OR ("cancelled_at" IS NOT NULL AND "cancelled_by_id" IS NOT NULL)',
)
export class Promotion extends BaseEntity {
  @Column("uuid") postId!: string;
  @ManyToOne(() => PostEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "postId" })
  post!: PostEntity;
  @Column({ type: "uuid", unique: true, nullable: true }) orderId!:
    string | null;
  @ManyToOne(() => PaymentOrder, { nullable: true, onDelete: "RESTRICT" })
  @JoinColumn({ name: "orderId" })
  order!: PaymentOrder | null;
  @Column({ type: "timestamptz" }) startsAt!: Date;
  @Column({ type: "timestamptz" }) endsAt!: Date;
  @Column({ name: "created_by_id", type: "uuid", nullable: true })
  createdById!: string | null;
  @ManyToOne(() => UserEntity, { nullable: true, onDelete: "RESTRICT" })
  @JoinColumn({ name: "created_by_id" })
  createdBy!: UserEntity | null;
  @Column({ name: "cancelled_at", type: "timestamptz", nullable: true })
  cancelledAt!: Date | null;
  @Column({ name: "cancelled_by_id", type: "uuid", nullable: true })
  cancelledById!: string | null;
  @ManyToOne(() => UserEntity, { nullable: true, onDelete: "RESTRICT" })
  @JoinColumn({ name: "cancelled_by_id" })
  cancelledBy!: UserEntity | null;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
