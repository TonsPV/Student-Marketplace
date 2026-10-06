import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { BaseEntity } from "../../../common/entities/base.entity";
import { MessageEntity } from "./message.entity";

// Ảnh tin nhắn: DB chỉ lưu key (prefix messages/{senderId}/), không lưu
// public URL hay presigned URL. position 0–4, giữ thứ tự gửi.
@Entity("message_images")
@Index("uq_message_images_key", ["key"], { unique: true })
@Index("uq_message_images_position", ["messageId", "position"], {
  unique: true,
})
@Check(
  "chk_message_images_position_range",
  '"position" >= 0 AND "position" <= 4',
)
export class MessageImageEntity extends BaseEntity {
  @Column({ name: "message_id", type: "uuid" })
  messageId!: string;

  @ManyToOne(() => MessageEntity, (msg) => msg.images, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "message_id" })
  message!: MessageEntity;

  @Column({ type: "varchar", length: 512 })
  key!: string;

  @Column({ type: "smallint" })
  position!: number;
}
