export const WS_EVENTS = {
  NOTIFICATION_NEW: "notification:new",
  CHAT_JOIN: "chat:join",
  CHAT_LEAVE: "chat:leave",
  CHAT_MESSAGE_NEW: "chat:message:new",
  CHAT_TYPING: "chat:typing",
} as const;

export const userRoom = (id: string) => `user:${id}`;
export const conversationRoom = (id: string) => `conversation:${id}`;
