export class MessageResponseDto {
  id!: string;
  conversationId!: string;
  senderId!: string;
  content!: string | null;   // đổi: có thể null khi tin chỉ có ảnh
  images!: string[];         // thêm: mảng url
  isRead!: boolean;
  createdAt!: Date;
}