import "reflect-metadata";
import type { Socket } from "socket.io";
import {
  SessionRegistryService,
  PENDING_HANDSHAKE_TIMEOUT_MS,
} from "../../src/common/session-registry/session-registry.service";
import { RealtimeService } from "../../src/modules/realtime/realtime.service";
const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
function socket(id: string, rooms = new Set<string>()) {
  return {
    id,
    connected: true,
    rooms,
    disconnect: jest.fn(),
  } as unknown as Socket;
}
describe("WebSocket session lifecycle", () => {
  let registry: SessionRegistryService;
  beforeEach(() => {
    jest.useFakeTimers();
    registry = new SessionRegistryService();
  });
  afterEach(() => {
    registry.clearAll();
    jest.useRealTimers();
  });
  it("indexes pending sessions before DB lookup and prevents later activation after lock", () => {
    const client = socket("pending");
    const reject = jest.fn();
    registry.registerPending(
      client,
      USER.toUpperCase(),
      Date.now() + 60000,
      reject,
    );
    registry.invalidateUser(USER);
    expect(reject).toHaveBeenCalledWith("UNAUTHORIZED");
    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(registry.activate(client.id)).toBeNull();
    expect(registry.isEligible(client.id)).toBe(false);
  });
  it("invalidates all markers before attempting any transport disconnect", () => {
    const a = socket("a"),
      b = socket("b");
    registry.registerPending(a, USER, Date.now() + 60000);
    registry.activate(a.id);
    registry.registerPending(b, USER, Date.now() + 60000);
    registry.activate(b.id);
    (a.disconnect as jest.Mock).mockImplementation(() => {
      expect(registry.isEligible(b.id)).toBe(false);
    });
    registry.invalidateUser(USER);
    expect(b.disconnect).toHaveBeenCalledTimes(1);
  });
  it("expires idle sockets and removes eligibility before disconnect", () => {
    const client = socket("a");
    registry.registerPending(client, USER, Date.now() + 2000);
    registry.activate(client.id);
    (client.disconnect as jest.Mock).mockImplementation(() =>
      expect(registry.isEligible(client.id)).toBe(false),
    );
    jest.advanceTimersByTime(2000);
    expect(client.disconnect).toHaveBeenCalledTimes(1);
    expect(registry.get(client.id)?.status).toBe("invalidated");
  });
  it("times out pending lookup and releases indexes/timer", () => {
    const client = socket("slow"),
      reject = jest.fn();
    registry.registerPending(client, USER, Date.now() + 60000, reject);
    jest.advanceTimersByTime(PENDING_HANDSHAKE_TIMEOUT_MS);
    expect(reject).toHaveBeenCalledWith("INTERNAL_ERROR");
    expect(registry.get(client.id)).toBeUndefined();
    expect(registry.activate(client.id)).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
  });
  it("emits only to active unexpired recipients in the requested room", () => {
    const a = socket("active", new Set(["conversation:c"])),
      p = socket("pending", new Set(["conversation:c"])),
      x = socket("invalid", new Set(["conversation:c"]));
    for (const client of [a, p, x])
      registry.registerPending(client, USER, Date.now() + 60000);
    registry.activate(a.id);
    registry.activate(x.id);
    registry.markInvalid(x.id);
    const emit = jest.fn(),
      to = jest.fn(() => ({ emit }));
    const realtime = new RealtimeService(registry);
    realtime.bindServer({ to } as never);
    realtime.emitToConversation("c", "event", {});
    expect(to).toHaveBeenCalledWith([a.id]);
    expect(emit).toHaveBeenCalledTimes(1);
    realtime.emitToConversation("c", "event", {}, a.id);
    expect(emit).toHaveBeenCalledTimes(1);
    registry.remove(a.id);
    realtime.emitToUser(USER, "event", {});
    expect(emit).toHaveBeenCalledTimes(1);
  });
  it("transport close cleanup removes user index and cancels timers", () => {
    const client = socket("a");
    registry.registerPending(client, USER, Date.now() + 60000);
    registry.activate(client.id);
    registry.remove(client.id);
    expect(registry.get(client.id)).toBeUndefined();
    expect(registry.invalidateUser(USER)).toEqual([]);
    expect(jest.getTimerCount()).toBe(0);
  });
});
