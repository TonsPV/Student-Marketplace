import {
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
import { MessageEntity } from "./message.entity";

// Lưu hội thoại giữa buyer và seller theo từng bài đăng.
@Entity("conversations")
@Index("uq_conversations_post_buyer", ["postId", "buyerId"], { unique: true })
@Index("idx_conversations_buyer_last_message_at", ["buyerId", "lastMessageAt"])
@Index("idx_conversations_seller_last_message_at", [
  "sellerId",
  "lastMessageAt",
])
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

  @OneToMany(() => MessageEntity, (msg) => msg.conversation)
  messages!: MessageEntity[];

  @CreateDateColumn({ name: "created_at" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt!: Date;
}
