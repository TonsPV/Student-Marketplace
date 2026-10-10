import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import type { Socket } from "socket.io";
export type SessionStatus = "pending" | "active" | "invalidated";
export interface SessionRecord {
  socketId: string;
  userId: string;
  socketRef: Socket;
  expiresAtMs: number;
  status: SessionStatus;
  timer: NodeJS.Timeout | null;
  rejectPending?: (reason: "UNAUTHORIZED" | "INTERNAL_ERROR") => void;
}
export const PENDING_HANDSHAKE_TIMEOUT_MS = 10000;
@Injectable()
export class SessionRegistryService implements OnModuleDestroy {
  private readonly logger = new Logger(SessionRegistryService.name);
  private readonly bySocket = new Map<string, SessionRecord>();
  private readonly byUser = new Map<string, Set<string>>();
  registerPending(
    socket: Socket,
    userId: string,
    expiresAtMs: number,
    rejectPending?: SessionRecord["rejectPending"],
  ): SessionRecord {
    if (this.bySocket.has(socket.id))
      throw new Error("Duplicate socket registration");
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now())
      throw new Error("Invalid socket expiry");
    const record: SessionRecord = {
      socketId: socket.id,
      userId: userId.toLowerCase(),
      socketRef: socket,
      expiresAtMs,
      status: "pending",
      timer: null,
      rejectPending,
    };
    this.bySocket.set(socket.id, record);
    const set = this.byUser.get(record.userId) ?? new Set<string>();
    set.add(socket.id);
    this.byUser.set(record.userId, set);
    record.timer = setTimeout(() => {
      if (record.status === "pending") {
        this.remove(socket.id);
        rejectPending?.("INTERNAL_ERROR");
      }
    }, PENDING_HANDSHAKE_TIMEOUT_MS);
    record.timer.unref();
    return record;
  }
  activate(socketId: string): SessionRecord | null {
    const record = this.bySocket.get(socketId);
    if (
      !record ||
      record.status !== "pending" ||
      record.expiresAtMs <= Date.now()
    )
      return null;
    if (record.timer) clearTimeout(record.timer);
    record.status = "active";
    record.rejectPending = undefined;
    this.armExpiry(record);
    return record;
  }
  private armExpiry(record: SessionRecord): void {
    const remaining = record.expiresAtMs - Date.now();
    if (remaining <= 0) {
      this.markInvalid(record.socketId);
      return;
    }
    record.timer = setTimeout(
      () => {
        if (
          this.bySocket.get(record.socketId) !== record ||
          record.status !== "active"
        )
          return;
        this.armExpiry(record);
      },
      Math.min(remaining, 2147483647),
    );
    record.timer.unref();
  }
  get(socketId: string): SessionRecord | undefined {
    return this.bySocket.get(socketId);
  }
  isCurrent(socketId: string): boolean {
    const r = this.bySocket.get(socketId);
    return !!r && r.status !== "invalidated" && r.expiresAtMs > Date.now();
  }
  isEligible(socketId: string, now = Date.now()): boolean {
    const r = this.bySocket.get(socketId);
    return (
      !!r &&
      r.status === "active" &&
      r.socketRef.connected &&
      r.expiresAtMs > now
    );
  }
  eligibleSocketsForUser(userId: string, now = Date.now()): SessionRecord[] {
    return [...(this.byUser.get(userId.toLowerCase()) ?? [])]
      .filter((id) => this.isEligible(id, now))
      .map((id) => this.bySocket.get(id)!);
  }
  eligibleSocketsForRoom(
    room: string,
    exceptSocketId?: string,
  ): SessionRecord[] {
    return [...this.bySocket.values()].filter(
      (r) =>
        r.socketId !== exceptSocketId &&
        this.isEligible(r.socketId) &&
        r.socketRef.rooms.has(room),
    );
  }
  invalidateUser(userId: string): SessionRecord[] {
    const records = [...(this.byUser.get(userId.toLowerCase()) ?? [])]
      .map((id) => this.bySocket.get(id)!)
      .filter(Boolean);
    for (const record of records) {
      record.status = "invalidated";
      if (record.timer) clearTimeout(record.timer);
      record.timer = null;
    }
    for (const record of records) this.disconnect(record);
    return records;
  }
  markInvalid(socketId: string): void {
    const r = this.bySocket.get(socketId);
    if (!r) return;
    r.status = "invalidated";
    if (r.timer) clearTimeout(r.timer);
    r.timer = null;
    this.disconnect(r);
  }
  private disconnect(record: SessionRecord): void {
    const reject = record.rejectPending;
    record.rejectPending = undefined;
    reject?.("UNAUTHORIZED");
    try {
      record.socketRef.disconnect(true);
    } catch (err) {
      this.logger.error(
        "Socket disconnect failed committed session invalid: " + String(err),
      );
    }
  }
  remove(socketId: string): void {
    const r = this.bySocket.get(socketId);
    if (!r) return;
    if (r.timer) clearTimeout(r.timer);
    this.bySocket.delete(socketId);
    const set = this.byUser.get(r.userId);
    set?.delete(socketId);
    if (set?.size === 0) this.byUser.delete(r.userId);
  }
  clearAll(): void {
    for (const r of this.bySocket.values()) if (r.timer) clearTimeout(r.timer);
    this.bySocket.clear();
    this.byUser.clear();
  }
  onModuleDestroy(): void {
    this.clearAll();
  }
}
