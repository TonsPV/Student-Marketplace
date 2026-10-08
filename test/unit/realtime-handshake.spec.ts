import "reflect-metadata";
import { EventEmitter } from "events";
import type { JwtService } from "@nestjs/jwt";
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
      verifyAsync: jest
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
      jwt as unknown as JwtService,
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
  it.each(["timeout", "abort"])(
    "%s settles next once and a late DB result cannot resurrect the session",
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
  it("JWT failure does not register pending state or query DB", async () => {
    const resolve = jest.fn().mockResolvedValue(principal),
      h = harness(resolve);
    h.jwt.verifyAsync.mockRejectedValue(Error("bad JWT"));
    await h.middleware(h.socket, h.next);
    expect(h.next.mock.calls[0][0].message).toBe("UNAUTHORIZED");
    expect(resolve).not.toHaveBeenCalled();
    expect(registry.get(h.socket.id)).toBeUndefined();
    expect(jest.getTimerCount()).toBe(0);
  });
  it("DB failure cleans pending state and surfaces INTERNAL_ERROR", async () => {
    const h = harness(() => Promise.reject(Error("DB unavailable")));
    await h.middleware(h.socket, h.next);
    expect(h.next.mock.calls[0][0].message).toBe("INTERNAL_ERROR");
    expect(registry.get(h.socket.id)).toBeUndefined();
    expect(jest.getTimerCount()).toBe(0);
  });
});
