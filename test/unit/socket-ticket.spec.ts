/**
 * MODULE: REALTIME (WEBSOCKET)
 *
 * WORD TEST CASES:
 * - TC-TIK-01: REST access key bị từ chối làm socket ticket; hết hạn ticket không rút ngắn session
 * - TC-TIK-02: Ticket hết hạn không mở được socket mới, kể cả khi access session còn hiệu lực
 * - TC-TIK-03: Client dùng access-JWT cũ vẫn xác thực bình thường
 * - TC-TIK-04: Tài khoản bị khóa không thể lấy ticket
 * - TC-TIK-05: Yêu cầu location được xác nhận từ DB, bất kể token claims nói onboarding đã xong
 */

import "reflect-metadata";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { createHmac } from "node:crypto";
import { AuthPrincipalService } from "../../src/common/auth-principal/auth-principal.service";
import { SocketTicketService } from "../../src/modules/realtime/socket-ticket.service";

describe("isolated socket tickets", () => {
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const secret = "unit-test-access-secret";
  const jwt = new JwtService({ secret });
  const principals = new AuthPrincipalService({} as never);
  const active = jest.spyOn(principals, "resolveActive");
  const tickets = new SocketTicketService(
    jwt,
    new ConfigService({ JWT_ACCESS_SECRET: secret }),
    principals,
  );
  beforeEach(() =>
    active.mockResolvedValue({
      id,
      email: "test@example.com",
      fullName: "Test",
      isAdmin: false,
    }),
  );
  // [WORD-TC: TC-TIK-01]
  // Chức năng: REST access key bị từ chối làm socket ticket; hết hạn ticket không rút ngắn session
  it("[TC-TIK-01] REST access key bị từ chối làm socket ticket; hết hạn ticket không rút ngắn session", async () => {
    const access = jwt.sign({ id }, { expiresIn: "15m" });
    const issued = await tickets.issue(access);
    await expect(jwt.verifyAsync(issued.ticket)).rejects.toThrow();
    const claims = await tickets.verify(issued.ticket);
    expect(claims.exp).toBe(jwt.decode(access).exp);
    expect(
      new Date(issued.sessionExpiresAt).getTime() -
        new Date(issued.expiresAt).getTime(),
    ).toBeGreaterThan(800000);
  });
  // [WORD-TC: TC-TIK-02]
  // Chức năng: Ticket hết hạn không mở được socket mới, kể cả khi access session còn hiệu lực
  it("[TC-TIK-02] Ticket hết hạn không mở được socket mới, kể cả khi access session còn hiệu lực", async () => {
    const ticketKey = createHmac("sha256", secret)
      .update("campusmarket:socket")
      .digest("hex");
    const expired = jwt.sign(
      {
        id,
        sub: id,
        scope: "socket",
        sessionExp: Math.floor(Date.now() / 1000) + 900,
        exp: Math.floor(Date.now() / 1000) - 1,
      },
      { secret: ticketKey, audience: "campusmarket:socket" },
    );
    await expect(tickets.verify(expired)).rejects.toThrow();
  });
  // [WORD-TC: TC-TIK-03]
  // Chức năng: Client dùng access-JWT cũ vẫn xác thực bình thường
  it("[TC-TIK-03] Client dùng access-JWT cũ vẫn xác thực bình thường", async () => {
    const access = jwt.sign({ id }, { expiresIn: "15m" });
    expect((await tickets.verify(access)).id).toBe(id);
  });
  // [WORD-TC: TC-TIK-04]
  // Chức năng: Tài khoản bị khóa không thể lấy ticket
  it("[TC-TIK-04] Tài khoản bị khóa không thể lấy ticket", async () => {
    active.mockRejectedValue(new Error("locked"));
    await expect(
      tickets.issue(jwt.sign({ id }, { expiresIn: "15m" })),
    ).rejects.toThrow("locked");
  });
  // [WORD-TC: TC-TIK-05]
  // Chức năng: Yêu cầu location được xác nhận từ DB, bất kể token claims nói onboarding đã xong
  it("[TC-TIK-05] Yêu cầu location được xác nhận từ DB, bất kể token claims nói onboarding đã xong", async () => {
    active.mockResolvedValue({
      id,
      email: "test@example.com",
      fullName: "Test",
      isAdmin: false,
      hasLocation: false,
    });
    await expect(
      tickets.issue(jwt.sign({ id, hasLocation: true }, { expiresIn: "15m" })),
    ).rejects.toMatchObject({ response: { code: "LOCATION_REQUIRED" } });
  });
});
