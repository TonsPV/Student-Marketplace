// message-image.entity.ts
import { BaseEntity } from "src/common/entities/base.entity";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { MessageEntity } from "./message.entity";


@Entity("message_images")
export class MessageImageEntity extends BaseEntity {
  @Index("idx_message_images_message_id")
  @Column({ name: "message_id", type: "uuid" })
  messageId!: string;

  @ManyToOne(() => MessageEntity, (msg) => msg.images, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "message_id" })
  message!: MessageEntity;

  @Column({ type: "text" })
  url!: string;
}