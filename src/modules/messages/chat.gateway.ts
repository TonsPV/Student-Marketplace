import { Logger } from "@nestjs/common";
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { isUUID } from "class-validator";
import { Namespace, Socket } from "socket.io";
import { ConversationsService } from "../conversations/conversations.service";
import { conversationRoom, WS_EVENTS } from "../realtime/realtime.events";

type AckOk = { ok: true };
type AckFail = {
  ok: false;
  error: "BAD_REQUEST" | "FORBIDDEN" | "INTERNAL_ERROR";
};
type Ack = AckOk | AckFail;

type AuthedSocket = Socket & {
  data: { user?: { id: string; email?: string } };
};

/**
 * Chat gateway dùng chung namespace /ws với RealtimeGateway — không thêm
 * middleware xác thực lần hai (RealtimeGateway.afterInit đã bind/auth).
 * Handlers validate raw payload thủ công và luôn trả ack có cấu trúc
 * (spec §7.3).
 */
@WebSocketGateway({ namespace: "/ws" })
export class ChatGateway {
  @WebSocketServer() server!: Namespace;
  private readonly logger = new Logger(ChatGateway.name);

  constructor(private readonly conversations: ConversationsService) {}

  @SubscribeMessage(WS_EVENTS.CHAT_JOIN)
  async handleJoin(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: unknown,
  ): Promise<Ack> {
    const conversationId = this.readConversationId(body);
    if (!conversationId) return { ok: false, error: "BAD_REQUEST" };
    const userId = client.data.user?.id;
    if (!userId) return { ok: false, error: "FORBIDDEN" };
    try {
      const allowed = await this.conversations.isParticipant(
        conversationId,
        userId,
      );
      if (!allowed) return { ok: false, error: "FORBIDDEN" };
      await client.join(conversationRoom(conversationId));
      return { ok: true };
    } catch (err) {
      this.logger.error(
        `chat:join failed: ${err instanceof Error ? err.message : err}`,
      );
      return { ok: false, error: "INTERNAL_ERROR" };
    }
  }

  @SubscribeMessage(WS_EVENTS.CHAT_LEAVE)
  async handleLeave(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: unknown,
  ): Promise<Ack> {
    const conversationId = this.readConversationId(body);
    if (!conversationId) return { ok: false, error: "BAD_REQUEST" };
    await client.leave(conversationRoom(conversationId));
    return { ok: true };
  }

  @SubscribeMessage(WS_EVENTS.CHAT_TYPING)
  handleTyping(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: unknown,
  ): Ack {
    if (!body || typeof body !== "object") {
      return { ok: false, error: "BAD_REQUEST" };
    }
    const { conversationId, isTyping } = body as {
      conversationId?: unknown;
      isTyping?: unknown;
    };
    // Không coerce 'false' thành true bằng !! — yêu cầu boolean thật.
    if (typeof conversationId !== "string" || !isUUID(conversationId)) {
      return { ok: false, error: "BAD_REQUEST" };
    }
    if (typeof isTyping !== "boolean") {
      return { ok: false, error: "BAD_REQUEST" };
    }
    // Chỉ relay nếu socket đã trong room (join đã authorize); không nhận
    // tên room từ client, không query participant mỗi typing.
    if (!client.rooms.has(conversationRoom(conversationId))) {
      return { ok: false, error: "FORBIDDEN" };
    }
    const userId = client.data.user?.id;
    if (!userId) return { ok: false, error: "FORBIDDEN" };
    client
      .to(conversationRoom(conversationId))
      .emit(WS_EVENTS.CHAT_TYPING, { conversationId, userId, isTyping });
    return { ok: true };
  }

  private readConversationId(body: unknown): string | null {
    if (!body || typeof body !== "object") return null;
    const conversationId = (body as { conversationId?: unknown })
      .conversationId;
    if (typeof conversationId !== "string" || !isUUID(conversationId)) {
      return null;
    }
    return conversationId;
  }
}
