import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  UpdateDateColumn,
} from "typeorm";
import { BaseEntity } from "../../../common/entities/base.entity";
import { PostEntity } from "../../posts/post.entity";
import { UserEntity } from "../../user/user.entity";
import { MessageEntity } from "../../messages/entities/message.entity";

// Hội thoại buyer/seller theo từng bài đăng. Mỗi (postId, buyerId) một row.
// Thứ tự chuẩn của tin là messages.sequence (bigint, string ở entity/JSON),
// không phải createdAt. Mọi bigint là string; chỉ dùng BigInt nội bộ (spec §3.1).
@Entity("conversations")
@Index("uq_conversations_post_buyer", ["postId", "buyerId"], { unique: true })
@Index("idx_conversations_buyer_last_message_at", ["buyerId", "lastMessageAt"])
@Index("idx_conversations_seller_last_message_at", [
  "sellerId",
  "lastMessageAt",
])
@Check("chk_conversations_buyer_ne_seller", '"buyer_id" <> "seller_id"')
export class ConversationEntity extends BaseEntity {
  @Column({ name: "post_id", type: "uuid" })
  postId!: string;

  @ManyToOne(() => PostEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "post_id" })
  post!: PostEntity;

  @Column({ name: "buyer_id", type: "uuid" })
  buyerId!: string;

  @ManyToOne(() => UserEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "buyer_id" })
  buyer!: UserEntity;

  @Column({ name: "seller_id", type: "uuid" })
  sellerId!: string;

  @ManyToOne(() => UserEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "seller_id" })
  seller!: UserEntity;

  @Column({ name: "last_message", type: "text", nullable: true })
  lastMessage!: string | null;

  @Column({ name: "last_message_at", type: "timestamptz", nullable: true })
  lastMessageAt!: Date | null;

  @Column({ name: "last_message_id", type: "uuid", nullable: true })
  lastMessageId!: string | null;

  @Column({ name: "last_message_sender_id", type: "uuid", nullable: true })
  lastMessageSenderId!: string | null;

  /** Counter cấp sequence, đồng thời là sequence tin mới nhất. 0 khi rỗng. */
  @Column({ name: "last_message_sequence", type: "bigint", default: "0" })
  lastMessageSequence!: string;

  /** Tăng mỗi mutation có thay đổi state; FE gate snapshot theo version. */
  @Column({ name: "state_version", type: "bigint", default: "0" })
  stateVersion!: string;

  /** Watermark buyer đã xem; không giảm. */
  @Column({ name: "buyer_read_sequence", type: "bigint", default: "0" })
  buyerReadSequence!: string;

  /** Watermark seller đã xem; không giảm. */
  @Column({ name: "seller_read_sequence", type: "bigint", default: "0" })
  sellerReadSequence!: string;

  @OneToMany(() => MessageEntity, (msg) => msg.conversation)
  messages!: MessageEntity[];

  @CreateDateColumn({ name: "created_at" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt!: Date;
}
