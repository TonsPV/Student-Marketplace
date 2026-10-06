export type ConversationRole = "buyer" | "seller";

export class ConversationPostDto {
  id!: string;
  title!: string;
  price!: string;
  status!: string;
  thumbnailUrl!: string | null;
}

export class ConversationCounterpartDto {
  id!: string;
  fullName!: string;
  avatarUrl!: string | null;
}

/**
 * ConversationSnapshotDto (spec §4.2): list/detail/event dùng chung shape.
 * unreadCount là số tuyệt đối; version/watermark là string (bigint).
 * Không trả nguyên UserEntity; historical relations chỉ field công khai.
 */
export class ConversationSnapshotDto {
  id!: string;
  post!: ConversationPostDto;
  counterpart!: ConversationCounterpartDto;
  role!: ConversationRole;
  lastMessageId!: string | null;
  lastMessage!: string | null;
  lastMessageAt!: Date | null;
  lastMessageSenderId!: string | null;
  lastMessageSequence!: string;
  stateVersion!: string;
  unreadCount!: number;
  buyerReadSequence!: string;
  sellerReadSequence!: string;
  createdAt!: Date;
}

/** Payload event chat:conversation:updated (state tuyệt đối, không delta). */
export type ConversationUpdatedPayload = {
  conversationId: string;
  stateVersion: string;
  lastMessageId: string | null;
  lastMessage: string | null;
  lastMessageAt: Date | null;
  lastMessageSenderId: string | null;
  lastMessageSequence: string;
  unreadCount: number;
  buyerReadSequence: string;
  sellerReadSequence: string;
};
