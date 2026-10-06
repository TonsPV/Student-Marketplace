export const WS_EVENTS = {
  NOTIFICATION_NEW: "notification:new",
  NOTIFICATION_CHANGED: "notification:changed",
  CHAT_JOIN: "chat:join",
  CHAT_LEAVE: "chat:leave",
  CHAT_MESSAGE_NEW: "chat:message:new",
  CHAT_CONVERSATION_UPDATED: "chat:conversation:updated",
  CHAT_READ: "chat:read",
  CHAT_TYPING: "chat:typing",
} as const;

/**
 * notification:new cũ không còn là authoritative contract cho NEW_MESSAGE;
 * FE migrate sang notification:changed snapshot (spec §7.1). Không phát đồng
 * thời hai event để FE cũ không tăng badge hai lần.
 */
export const userRoom = (id: string) => `user:${id}`;
export const conversationRoom = (id: string) => `conversation:${id}`;

export type ChatReadPayload = {
  conversationId: string;
  readerId: string;
  readThroughSequence: string;
  stateVersion: string;
  readAt: string;
};
