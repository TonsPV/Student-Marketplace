export class MessageResponseDto {
  id!: string;
  conversationId!: string;
  senderId!: string;
  /** bigint serialize thành string, không mất precision. */
  sequence!: string;
  content!: string | null;
  /** Presigned GET đúng thứ tự position. */
  images!: string[];
  /** ISO expiry sớm nhất của nhóm ảnh; null nếu không có ảnh. */
  imagesExpireAt!: string | null;
  isRead!: boolean;
  createdAt!: Date;
  /** Persist; có cả trong history/replay/event. */
  clientId!: string | null;
}
