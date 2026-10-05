import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { UserEntity } from "../user/user.entity";

export enum ReportTargetType {
  POST = "POST",
  USER = "USER",
}

export enum ReportReason {
  SPAM = "SPAM",
  INAPPROPRIATE_CONTENT = "INAPPROPRIATE_CONTENT", //noi dung khong phu hop
  FRAUD = "FRAUD", //lua dao
  HARASSMENT = "HARASSMENT", //quay roi
  COUNTERFEIT_GOODS = "COUNTERFEIT_GOODS", //hang gia
  DANGEROUS_GOODS = "DANGEROUS_GOODS", //hang nguy hiem
  OTHER = "OTHER",
}

export enum ReportStatus {
  PENDING = "PENDING",
  RESOLVED = "RESOLVED",
  DISMISSED = "DISMISSED",
}

@Entity("reports")
export class ReportEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "reporter_id", type: "uuid" })
  reporterId!: string;

  @ManyToOne(() => UserEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "reporter_id" })
  reporter!: UserEntity;

  @Column({
    name: "target_type",
    type: "enum",
    enum: ReportTargetType,
  })
  targetType!: ReportTargetType;

  @Column({ name: "target_id", type: "uuid" })
  targetId!: string;

  @Column({
    type: "enum",
    enum: ReportReason,
  })
  reason!: ReportReason;

  @Column({ type: "text" })
  description!: string;

  @Column({
    name: "evidence_urls",
    type: "text",
    array: true,
    default: "{}",
  })
  evidenceUrls!: string[];

  @Column({
    type: "enum",
    enum: ReportStatus,
    default: ReportStatus.PENDING,
  })
  status!: ReportStatus;

  @Column({ name: "admin_note", type: "text", nullable: true })
  adminNote!: string | null;

  @Column({ name: "resolved_by_id", type: "uuid", nullable: true })
  resolvedById!: string | null;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "resolved_by_id" })
  resolvedBy!: UserEntity | null;

  @Column({ name: "resolved_at", type: "timestamptz", nullable: true })
  resolvedAt!: Date | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt!: Date;
}
