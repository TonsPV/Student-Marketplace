import {
  ForbiddenException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
} from "@nestjs/websockets";
import { isUUID } from "class-validator";
import { Socket } from "socket.io";
import { AuthPrincipalService } from "../../common/auth-principal/auth-principal.service";
import { SessionRegistryService } from "../../common/session-registry/session-registry.service";
import { AuthorizationService } from "../authorization/authorization.service";
import { ConversationsService } from "../conversations/conversations.service";
import { conversationRoom, WS_EVENTS } from "../realtime/realtime.events";
import { RealtimeService } from "../realtime/realtime.service";

type Ack =
  | { ok: true }
  | { ok: false; error: "BAD_REQUEST" | "FORBIDDEN" | "INTERNAL_ERROR" };
@WebSocketGateway({ namespace: "/ws" })
export class ChatGateway {
  private readonly logger = new Logger(ChatGateway.name);
  constructor(
    private readonly conversations: ConversationsService,
    private readonly principals: AuthPrincipalService,
    private readonly authorization: AuthorizationService,
    private readonly sessions: SessionRegistryService,
    private readonly realtime: RealtimeService,
  ) {}
  private readConversationId(body: unknown): string | null {
    if (!body || typeof body !== "object" || Array.isArray(body)) return null;
    const id = (body as { conversationId?: unknown }).conversationId;
    return typeof id === "string" && isUUID(id) ? id.toLowerCase() : null;
  }
  private async authorize(
    client: Socket,
    id: string,
    action: "join" | "type",
  ): Promise<boolean> {
    if (!this.sessions.isEligible(client.id)) return false;
    const record = this.sessions.get(client.id)!;
    const principal = await this.principals.resolveActive(record.userId);
    if (!this.sessions.isEligible(client.id)) return false;
    await this.conversations.getForAction(
      id,
      this.authorization.createAuthenticatedContext(principal),
      action,
    );
    return this.sessions.isEligible(client.id);
  }
  private failure(client: Socket, error: unknown): Ack {
    if (error instanceof UnauthorizedException)
      this.sessions.markInvalid(client.id);
    if (
      error instanceof UnauthorizedException ||
      error instanceof ForbiddenException ||
      error instanceof NotFoundException
    )
      return { ok: false, error: "FORBIDDEN" };
    this.logger.error("Chat authorization failed");
    return { ok: false, error: "INTERNAL_ERROR" };
  }
  @SubscribeMessage(WS_EVENTS.CHAT_JOIN)
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown,
  ): Promise<Ack> {
    const id = this.readConversationId(body);
    if (!id) return { ok: false, error: "BAD_REQUEST" };
    try {
      if (!(await this.authorize(client, id, "join")))
        return { ok: false, error: "FORBIDDEN" };
      await client.join(conversationRoom(id));
      if (!this.sessions.isEligible(client.id)) {
        await client.leave(conversationRoom(id));
        return { ok: false, error: "FORBIDDEN" };
      }
      return { ok: true };
    } catch (error) {
      return this.failure(client, error);
    }
  }
  @SubscribeMessage(WS_EVENTS.CHAT_LEAVE)
  async handleLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown,
  ): Promise<Ack> {
    const id = this.readConversationId(body);
    if (!id) return { ok: false, error: "BAD_REQUEST" };
    if (!this.sessions.isEligible(client.id))
      return { ok: false, error: "FORBIDDEN" };
    try {
      await client.leave(conversationRoom(id));
      return { ok: true };
    } catch (error) {
      return this.failure(client, error);
    }
  }
  @SubscribeMessage(WS_EVENTS.CHAT_TYPING)
  async handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown,
  ): Promise<Ack> {
    const id = this.readConversationId(body);
    const isTyping = (body as { isTyping?: unknown } | null)?.isTyping;
    if (!id || typeof isTyping !== "boolean")
      return { ok: false, error: "BAD_REQUEST" };
    if (
      !this.sessions.isEligible(client.id) ||
      !client.rooms.has(conversationRoom(id))
    )
      return { ok: false, error: "FORBIDDEN" };
    try {
      if (
        !(await this.authorize(client, id, "type")) ||
        !client.rooms.has(conversationRoom(id))
      )
        return { ok: false, error: "FORBIDDEN" };
      this.realtime.emitToConversation(
        id,
        WS_EVENTS.CHAT_TYPING,
        {
          conversationId: id,
          userId: this.sessions.get(client.id)!.userId,
          isTyping,
        },
        client.id,
      );
      return { ok: true };
    } catch (error) {
      return this.failure(client, error);
    }
  }
}
