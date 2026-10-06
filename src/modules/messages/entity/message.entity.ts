import { BaseEntity } from "src/common/entities/base.entity";
import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
    OneToMany,
} from "typeorm";
import { ConversationEntity } from "../../conversations/entities/conversation.entity";
import { UserEntity } from "../../user/user.entity";
import { MessageImageEntity } from "./message-image.entity";

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

    @Column({ type: "text", nullable: true })
    content!: string | null;

    @OneToMany(() => MessageImageEntity, (img) => img.message, {
        cascade: ["insert"],
    })
    images!: MessageImageEntity[];

    @Column({ name: "is_read", default: false })
    isRead!: boolean;

    @CreateDateColumn({ name: "created_at" })
    createdAt!: Date;
}
