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

export type PasswordResetStatus =
  "pending" | "active" | "verified" | "consumed" | "invalidated" | "failed";

@Entity("password_reset_challenges")
@Index("idx_password_reset_user_created", ["userId", "createdAt"])
@Index("idx_password_reset_created", ["createdAt"])
@Check(
  "chk_password_reset_status",
  `"status" IN ('pending', 'active', 'verified', 'consumed', 'invalidated', 'failed')`,
)
@Check("chk_password_reset_attempts", `"failed_attempts" BETWEEN 0 AND 5`)
export class PasswordResetChallengeEntity extends BaseEntity {
  @Column({ name: "user_id", type: "uuid" })
  userId!: string;

  @ManyToOne(() => UserEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user!: UserEntity;

  @Column({ name: "otp_hash", type: "varchar", length: 64, nullable: true })
  otpHash!: string | null;

  @Column({ name: "otp_expires_at", type: "timestamptz" })
  otpExpiresAt!: Date;

  @Column({ name: "failed_attempts", default: 0 })
  failedAttempts!: number;

  @Column({ type: "varchar", length: 16, default: "pending" })
  status!: PasswordResetStatus;

  @Index("idx_password_reset_token_hash", { unique: true })
  @Column({
    name: "reset_token_hash",
    type: "varchar",
    length: 64,
    nullable: true,
  })
  resetTokenHash!: string | null;

  @Column({
    name: "reset_token_expires_at",
    type: "timestamptz",
    nullable: true,
  })
  resetTokenExpiresAt!: Date | null;

  @Column({ name: "consumed_at", type: "timestamptz", nullable: true })
  consumedAt!: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
