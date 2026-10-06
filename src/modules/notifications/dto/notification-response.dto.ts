import { NotificationType } from "../notification.entity";

export class NotificationResponseDto {
  id!: string;
  type!: NotificationType;
  /** Với NEW_MESSAGE luôn là conversationId. */
  refId!: string | null;
  title!: string;
  body!: string | null;
  isRead!: boolean;
  lastMessageSequence!: string | null;
  conversationVersion!: string | null;
  createdAt!: Date;
  updatedAt!: Date;
}

/**
 * Snapshot đồng bộ FE (spec §6.3): luôn chỉ ra unread record hiện tại
 * (hoặc null), kèm các record đổi trong transaction.
 */
export type NotificationSnapshot = {
  conversationId: string;
  stateVersion: string;
  unreadNotification: NotificationResponseDto | null;
  changed: NotificationResponseDto[];
};
