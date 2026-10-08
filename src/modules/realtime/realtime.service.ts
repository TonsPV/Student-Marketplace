import { Injectable } from "@nestjs/common";
import { Namespace } from "socket.io";
import { conversationRoom } from "./realtime.events";
import { SessionRegistryService } from "../../common/session-registry/session-registry.service";

@Injectable()
export class RealtimeService {
  constructor(private readonly sessions: SessionRegistryService) {}
  private server!: Namespace;
  private online = new Map<string, number>(); // userId -> số socket đang mở

  bindServer(server: Namespace) {
    this.server = server;
  }

  emitToUser(userId: string, event: string, payload: unknown) {
    const ids = this.sessions
      .eligibleSocketsForUser(userId)
      .map((r) => r.socketId);
    if (ids.length) this.server.to(ids).emit(event, payload);
  }
  emitToConversation(
    id: string,
    event: string,
    payload: unknown,
    exceptSocketId?: string,
  ) {
    const ids = this.sessions
      .eligibleSocketsForRoom(conversationRoom(id), exceptSocketId)
      .map((r) => r.socketId);
    if (ids.length) this.server.to(ids).emit(event, payload);
  }

  markOnline(userId: string) {
    this.online.set(userId, (this.online.get(userId) ?? 0) + 1);
  }
  markOffline(userId: string) {
    const n = (this.online.get(userId) ?? 1) - 1;
    n <= 0 ? this.online.delete(userId) : this.online.set(userId, n);
  }
  isOnline(userId: string) {
    return this.sessions.eligibleSocketsForUser(userId).length > 0;
  }
}
