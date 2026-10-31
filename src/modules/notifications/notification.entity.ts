import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  UpdateDateColumn,
} from "typeorm";
import { BaseEntity } from "../../common/entities/base.entity";
import { UserEntity } from "../user/user.entity";

export enum NotificationType {
  NEW_MESSAGE = "new_message",
  REVIEW_REQUEST = "review_request",
  POST_EXPIRING = "post_expiring",
  POST_EXPIRED = "post_expired",
}

export type NotificationTargetType =
  "conversation" | "purchase" | "my_post" | "posting_status" | "payment";

// Mỗi (user, conversation) tối đa một NEW_MESSAGE chưa đọc: partial unique
// index + atomic upsert (spec §3.3, §6.1). lastMessageSequence/conversationVersion
// serialize thành string ở DTO.
@Entity("notifications")
@Index("uq_notifications_new_message_unread", ["userId", "type", "refId"], {
  unique: true,
  where: `"type" = 'new_message' AND "is_read" = false AND "ref_id" IS NOT NULL`,
})
@Index("idx_notifications_user_read_updated", ["userId", "isRead", "updatedAt"])
@Index("uq_notifications_dedup_key", ["dedupKey"], {
  unique: true,
  where: '"dedup_key" IS NOT NULL',
})
export class NotificationEntity extends BaseEntity {
  @Column({ name: "user_id", type: "uuid" })
  userId!: string;

  @ManyToOne(() => UserEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user!: UserEntity;

  @Column({ name: "type", type: "enum", enum: NotificationType })
  type!: NotificationType;

  /** Với NEW_MESSAGE luôn là conversationId. */
  @Column({ name: "ref_id", type: "uuid", nullable: true })
  refId!: string | null;

  @Column({ name: "target_type", type: "varchar", length: 30, nullable: true })
  targetType!: NotificationTargetType | null;

  @Column({ name: "dedup_key", type: "varchar", length: 200, nullable: true })
  dedupKey!: string | null;

  @Column({ type: "varchar", length: 200 })
  title!: string;

  @Column({ type: "text", nullable: true })
  body!: string | null;

  @Column({ name: "is_read", default: false })
  isRead!: boolean;

  @Column({ name: "last_message_sequence", type: "bigint", nullable: true })
  lastMessageSequence!: string | null;

  @Column({ name: "conversation_version", type: "bigint", nullable: true })
  conversationVersion!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
