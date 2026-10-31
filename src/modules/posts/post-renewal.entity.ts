import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
} from "typeorm";
import { BaseEntity } from "../../common/entities/base.entity";
import { PostEntity } from "./post.entity";

export enum PostRenewalKind {
  FREE = "free",
  PAID = "paid",
}

@Entity("post_renewals")
@Index("uq_post_renewals_cycle", ["postId", "renewalNumber"], { unique: true })
@Index("uq_post_renewals_payment", ["paymentReference"], {
  unique: true,
  where: '"payment_reference" IS NOT NULL',
})
@Check("chk_post_renewals_number", '"renewal_number" > 0')
@Check(
  "chk_post_renewals_kind",
  `("kind" = 'free' AND "renewal_number" = 1 AND "payment_reference" IS NULL) OR ("kind" = 'paid' AND "renewal_number" > 1 AND "payment_reference" IS NOT NULL)`,
)
export class PostRenewalEntity extends BaseEntity {
  @Column({ name: "post_id", type: "uuid" })
  postId!: string;

  @ManyToOne(() => PostEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "post_id" })
  post!: PostEntity;

  @Column({ name: "renewal_number", type: "integer" })
  renewalNumber!: number;

  @Column({ type: "varchar", length: 10 })
  kind!: PostRenewalKind;

  @Column({
    name: "payment_reference",
    type: "varchar",
    length: 150,
    nullable: true,
  })
  paymentReference!: string | null;

  @Column({ name: "previous_expires_at", type: "timestamptz" })
  previousExpiresAt!: Date;

  @Column({ name: "published_at", type: "timestamptz" })
  publishedAt!: Date;

  @Column({ name: "expires_at", type: "timestamptz" })
  expiresAt!: Date;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
