import { Injectable } from "@nestjs/common";
import { Namespace } from "socket.io";
import { userRoom, conversationRoom } from "./realtime.events";

@Injectable()
export class RealtimeService {
  private server!: Namespace;
  private online = new Map<string, number>(); // userId -> số socket đang mở

  bindServer(server: Namespace) {
    this.server = server;
  }

  emitToUser(userId: string, event: string, payload: unknown) {
    this.server.to(userRoom(userId)).emit(event, payload);
  }
  emitToConversation(
    id: string,
    event: string,
    payload: unknown,
    exceptSocketId?: string,
  ) {
    const target = this.server.to(conversationRoom(id));
    (exceptSocketId ? target.except(exceptSocketId) : target).emit(
      event,
      payload,
    );
  }

  markOnline(userId: string) {
    this.online.set(userId, (this.online.get(userId) ?? 0) + 1);
  }
  markOffline(userId: string) {
    const n = (this.online.get(userId) ?? 1) - 1;
    n <= 0 ? this.online.delete(userId) : this.online.set(userId, n);
  }
  isOnline(userId: string) {
    return this.online.has(userId);
  }
}
