/**
 * MODULE: REALTIME (WEBSOCKET)
 *
 * WORD TEST CASES:
 * - TC-RT-01: Timeout chốt kết quả đúng một lần; kết quả DB trả về muộn không hồi sinh session
 * - TC-RT-02: Abort chốt kết quả đúng một lần; kết quả DB trả về muộn không hồi sinh session
 * - TC-RT-03: JWT lỗi → không đăng ký pending state, không truy vấn DB
 * - TC-RT-04: DB lỗi → dọn pending state và trả INTERNAL_ERROR
 * - TC-RT-05: Tài khoản chưa hoàn tất không qua được onboarding bằng handshake access-JWT
 */

import "reflect-metadata";
import { EventEmitter } from "events";
import type { SocketTicketService } from "../../src/modules/realtime/socket-ticket.service";
import type { Namespace, Socket } from "socket.io";
import { RealtimeGateway } from "../../src/modules/realtime/realtime.gateway";
import type { RealtimeService } from "../../src/modules/realtime/realtime.service";
import { AuthPrincipalService } from "../../src/common/auth-principal/auth-principal.service";
import { SessionRegistryService } from "../../src/common/session-registry/session-registry.service";
// JWT verification belongs to JWT/HTTP tests; this suite exercises middleware settlement.
jest.mock("@nestjs/jwt", () => ({ JwtService: class {} }));
const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const principal = {
  id: ID,
  email: "test@example.com",
  fullName: "Test",
  isAdmin: false,
};
describe("handshake settlement and cleanup", () => {
  let registry: SessionRegistryService;
  beforeEach(() => {
    jest.useFakeTimers();
    registry = new SessionRegistryService();
  });
  afterEach(() => {
    registry.clearAll();
    jest.useRealTimers();
  });
  function harness(resolve: () => Promise<typeof principal>) {
    const conn = Object.assign(new EventEmitter(), { readyState: "open" });
    const socket = {
      id: "pending",
      data: {},
      conn,
      connected: false,
      handshake: { auth: { token: "valid" }, headers: {} },
      rooms: new Set<string>(),
      disconnect: jest.fn(),
      join: jest.fn().mockResolvedValue(undefined),
    } as unknown as Socket;
    const jwt = {
      verify: jest
        .fn()
        .mockResolvedValue({ id: ID, exp: Date.now() / 1000 + 60 }),
    };
    const resolver = new AuthPrincipalService({} as never);
    jest
      .spyOn(resolver, "resolveFromVerifiedClaims")
      .mockImplementation(resolve);
    const realtime = {
      bindServer: jest.fn(),
      markOnline: jest.fn(),
      markOffline: jest.fn(),
    };
    const gateway = new RealtimeGateway(
      jwt as unknown as SocketTicketService,
      realtime as unknown as RealtimeService,
      resolver,
      registry,
    );
    let middleware!: (
      socket: Socket,
      next: (error?: Error) => void,
    ) => Promise<void>;
    gateway.afterInit({
      use: (callback: typeof middleware) => {
        middleware = callback;
      },
    } as unknown as Namespace);
    return {
      socket,
      conn,
      next: jest.fn(),
      middleware,
      gateway,
      realtime,
      jwt,
    };
  }
  // [WORD-TC: TC-RT-01]
  // Chức năng: Timeout chốt kết quả đúng một lần; kết quả DB trả về muộn không hồi sinh session
  // [WORD-TC: TC-RT-02]
  // Chức năng: Abort chốt kết quả đúng một lần; kết quả DB trả về muộn không hồi sinh session
  it.each(["timeout", "abort"])(
    "[TC-RT] Cơ chế %s hoàn tất kết quả đúng 1 lần, kết quả DB về muộn không hồi sinh session",
    async (reason) => {
      let release!: (value: typeof principal) => void, entered!: () => void;
      const result = new Promise<typeof principal>(
          (resolve) => (release = resolve),
        ),
        started = new Promise<void>((resolve) => (entered = resolve));
      const h = harness(() => {
        entered();
        return result;
      });
      const pending = h.middleware(h.socket, h.next);
      await started;
      expect(registry.get(h.socket.id)?.status).toBe("pending");
      if (reason === "timeout") jest.advanceTimersByTime(10000);
      else h.conn.emit("close");
      expect(h.next).toHaveBeenCalledTimes(1);
      expect(h.next.mock.calls[0][0].message).toBe(
        reason === "timeout" ? "INTERNAL_ERROR" : "UNAUTHORIZED",
      );
      expect(registry.get(h.socket.id)).toBeUndefined();
      release(principal);
      await pending;
      expect(h.next).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
      await h.gateway.handleConnection(h.socket);
      expect(h.realtime.markOnline).not.toHaveBeenCalled();
      expect(registry.activate(h.socket.id)).toBeNull();
    },
  );
  // [WORD-TC: TC-RT-03]
  // Chức năng: JWT lỗi → không đăng ký pending state, không truy vấn DB
  it("[TC-RT-03] JWT lỗi → không đăng ký pending state, không truy vấn DB", async () => {
    const resolve = jest.fn().mockResolvedValue(principal),
      h = harness(resolve);
    h.jwt.verify.mockRejectedValue(Error("bad JWT"));
    await h.middleware(h.socket, h.next);
    expect(h.next.mock.calls[0][0].message).toBe("UNAUTHORIZED");
    expect(resolve).not.toHaveBeenCalled();
    expect(registry.get(h.socket.id)).toBeUndefined();
    expect(jest.getTimerCount()).toBe(0);
  });
  // [WORD-TC: TC-RT-04]
  // Chức năng: DB lỗi → dọn pending state và trả INTERNAL_ERROR
  it("[TC-RT-04] DB lỗi → dọn pending state và trả INTERNAL_ERROR", async () => {
    const h = harness(() => Promise.reject(Error("DB unavailable")));
    await h.middleware(h.socket, h.next);
    expect(h.next.mock.calls[0][0].message).toBe("INTERNAL_ERROR");
    expect(registry.get(h.socket.id)).toBeUndefined();
    expect(jest.getTimerCount()).toBe(0);
  });
  // [WORD-TC: TC-RT-05]
  // Chức năng: Tài khoản chưa hoàn tất không qua được onboarding bằng handshake access-JWT
  it("[TC-RT-05] Tài khoản chưa hoàn tất không qua được onboarding bằng handshake access-JWT", async () => {
    const h = harness(async () => ({ ...principal, hasLocation: false }));
    await h.middleware(h.socket, h.next);
    expect(h.next.mock.calls[0][0].message).toBe("LOCATION_REQUIRED");
    expect(registry.get(h.socket.id)).toBeUndefined();
    expect(jest.getTimerCount()).toBe(0);
    await h.gateway.handleConnection(h.socket);
    expect(h.realtime.markOnline).not.toHaveBeenCalled();
  });
});
