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

/**
 * Violation warning. History only: a warning never blocks posting and is
 * never updated or hard-deleted by the application.
 */
@Entity("user_warnings")
@Index("idx_user_warnings_user_created", ["userId", "createdAt"])
@Check("chk_user_warnings_reason_not_blank", `btrim("reason") <> ''`)
@Check("chk_user_warnings_not_self", `"issued_by_id" <> "user_id"`)
export class UserWarningEntity extends BaseEntity {
  @Column({ name: "user_id", type: "uuid" })
  userId!: string;

  @ManyToOne(() => UserEntity, { onDelete: "RESTRICT" })
  @JoinColumn({
    name: "user_id",
    foreignKeyConstraintName: "fk_user_warnings_user",
  })
  user!: UserEntity;

  @Column({ type: "text" })
  reason!: string;

  @Column({ name: "issued_by_id", type: "uuid" })
  issuedById!: string;

  @ManyToOne(() => UserEntity, { onDelete: "RESTRICT" })
  @JoinColumn({
    name: "issued_by_id",
    foreignKeyConstraintName: "fk_user_warnings_issued_by",
  })
  issuedBy!: UserEntity;

  @Column({ name: "source_report_id", type: "uuid", nullable: true })
  sourceReportId!: string | null;

  @ManyToOne(() => ReportEntity, { nullable: true, onDelete: "RESTRICT" })
  @JoinColumn({
    name: "source_report_id",
    foreignKeyConstraintName: "fk_user_warnings_source_report",
  })
  sourceReport!: ReportEntity | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
