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
import { UserEntity } from "../user/user.entity";
import { ReportEntity } from "../reports/report.entity";
import { PostingRestrictionType } from "./posting-restriction.rules";

/**
 * Posting restriction history. Independent from `user.is_locked`: it only
 * controls creating (or restoring) posts. Lifting fills the lift columns and
 * keeps the row; expiry is evaluated on read.
 */
@Entity("posting_restrictions")
@Index("idx_posting_restrictions_user_unlifted", ["userId", "startsAt"], {
  where: '"lifted_at" IS NULL',
})
@Index("idx_posting_restrictions_user_created", ["userId", "createdAt"])
@Check("chk_posting_restrictions_type", `"type" IN ('TEMPORARY', 'PERMANENT')`)
@Check(
  "chk_posting_restrictions_expiry",
  `("type" = 'PERMANENT' AND "expires_at" IS NULL) OR ("type" = 'TEMPORARY' AND "expires_at" IS NOT NULL AND "expires_at" > "starts_at")`,
)
@Check("chk_posting_restrictions_reason_not_blank", `btrim("reason") <> ''`)
@Check(
  "chk_posting_restrictions_lift",
  `("lifted_at" IS NULL AND "lifted_by_id" IS NULL AND "lift_reason" IS NULL) OR ("lifted_at" IS NOT NULL AND "lifted_by_id" IS NOT NULL AND "lift_reason" IS NOT NULL AND btrim("lift_reason") <> '')`,
)
@Check(
  "chk_posting_restrictions_not_self",
  `"issued_by_id" <> "user_id" AND ("lifted_by_id" IS NULL OR "lifted_by_id" <> "user_id")`,
)
export class PostingRestrictionEntity extends BaseEntity {
  @Column({ name: "user_id", type: "uuid" })
  userId!: string;

  @ManyToOne(() => UserEntity, { onDelete: "RESTRICT" })
  @JoinColumn({
    name: "user_id",
    foreignKeyConstraintName: "fk_posting_restrictions_user",
  })
  user!: UserEntity;

  @Column({ type: "varchar", length: 20 })
  type!: PostingRestrictionType;

  @Column({ type: "text" })
  reason!: string;

  @Column({ name: "starts_at", type: "timestamptz" })
  startsAt!: Date;

  @Column({ name: "expires_at", type: "timestamptz", nullable: true })
  expiresAt!: Date | null;

  @Column({ name: "issued_by_id", type: "uuid" })
  issuedById!: string;

  @ManyToOne(() => UserEntity, { onDelete: "RESTRICT" })
  @JoinColumn({
    name: "issued_by_id",
    foreignKeyConstraintName: "fk_posting_restrictions_issued_by",
  })
  issuedBy!: UserEntity;

  @Column({ name: "source_report_id", type: "uuid", nullable: true })
  sourceReportId!: string | null;

  @ManyToOne(() => ReportEntity, { nullable: true, onDelete: "RESTRICT" })
  @JoinColumn({
    name: "source_report_id",
    foreignKeyConstraintName: "fk_posting_restrictions_source_report",
  })
  sourceReport!: ReportEntity | null;

  @Column({ name: "lifted_at", type: "timestamptz", nullable: true })
  liftedAt!: Date | null;

  @Column({ name: "lifted_by_id", type: "uuid", nullable: true })
  liftedById!: string | null;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: "RESTRICT" })
  @JoinColumn({
    name: "lifted_by_id",
    foreignKeyConstraintName: "fk_posting_restrictions_lifted_by",
  })
  liftedBy!: UserEntity | null;

  @Column({ name: "lift_reason", type: "text", nullable: true })
  liftReason!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
