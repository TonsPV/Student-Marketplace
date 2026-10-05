import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
} from "typeorm";
import { BaseEntity } from "../../../common/entities/base.entity";
import { UserEntity } from "../../user/user.entity";
import { ConversationEntity } from "./conversation.entity";

// Lưu tin nhắn thuộc một hội thoại.
@Entity("messages")
@Index("idx_messages_conversation_created_at", ["conversationId", "createdAt"])
export class MessageEntity extends BaseEntity {
  @Column({ name: "conversation_id", type: "uuid" })
  conversationId!: string;

  @ManyToOne(() => ConversationEntity, (conv) => conv.messages, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "conversation_id" })
  conversation!: ConversationEntity;

  @Column({ name: "sender_id", type: "uuid" })
  senderId!: string;

  @ManyToOne(() => UserEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "sender_id" })
  sender!: UserEntity;

  @Column({ type: "text" })
  content!: string;

  @Column({ name: "is_read", default: false })
  isRead!: boolean;

  @CreateDateColumn({ name: "created_at" })
  createdAt!: Date;
}
