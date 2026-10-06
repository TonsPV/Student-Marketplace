import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
} from "typeorm";
import { BaseEntity } from "../../../common/entities/base.entity";
import { ConversationEntity } from "../../conversations/entities/conversation.entity";
import { UserEntity } from "../../user/user.entity";
import { MessageImageEntity } from "./message-image.entity";

// Canonical MessageEntity duy nhất của bảng messages (spec §2.1, §3.2).
// sequence bigint (string ở entity/JSON) là thứ tự chuẩn trong conversation,
// cấp dưới row lock, bắt đầu từ 1. UUIDv7 chỉ là định danh.
@Entity("messages")
@Index("uq_messages_conversation_sequence", ["conversationId", "sequence"], {
  unique: true,
})
@Index("uq_messages_sender_client", ["senderId", "clientId"], {
  unique: true,
  where: '"client_id" IS NOT NULL',
})
@Index(
  "idx_messages_conversation_unread",
  ["conversationId", "senderId", "sequence"],
  {
    where: '"is_read" = false',
  },
)
@Check("chk_messages_sequence_positive", '"sequence" > 0')
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

  @Column({ name: "sequence", type: "bigint" })
  sequence!: string;

  @Column({ type: "text", nullable: true })
  content!: string | null;

  /**
   * Idempotency key theo sender (E1 bắt buộc, alias cũ optional).
   * Cùng key/payload trả cùng message; cùng key khác payload → 409.
   */
  @Column({ name: "client_id", type: "varchar", length: 64, nullable: true })
  clientId!: string | null;

  @OneToMany(() => MessageImageEntity, (img) => img.message, {
    cascade: ["insert"],
  })
  images!: MessageImageEntity[];

  @Column({ name: "is_read", default: false })
  isRead!: boolean;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
