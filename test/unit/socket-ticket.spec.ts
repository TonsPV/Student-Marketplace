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
  it("REST access key rejects a socket ticket; ticket expiry does not shorten the session", async () => {
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
  it("expired ticket cannot start a new socket, even while the access session is valid", async () => {
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
  it("existing access-JWT clients continue to authenticate", async () => {
    const access = jwt.sign({ id }, { expiresIn: "15m" });
    expect((await tickets.verify(access)).id).toBe(id);
  });
  it("locked accounts cannot obtain a ticket", async () => {
    active.mockRejectedValue(new Error("locked"));
    await expect(
      tickets.issue(jwt.sign({ id }, { expiresIn: "15m" })),
    ).rejects.toThrow("locked");
  });
});
