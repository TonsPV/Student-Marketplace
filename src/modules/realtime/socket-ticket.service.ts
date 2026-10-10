import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { createHmac } from "node:crypto";
import {
  AuthPrincipalService,
  VerifiedClaims,
} from "../../common/auth-principal/auth-principal.service";

const AUDIENCE = "campusmarket:socket";
type TicketClaims = VerifiedClaims & { sessionExp?: unknown; scope?: unknown };

@Injectable()
export class SocketTicketService {
  private readonly secret: string;
  constructor(
    private readonly jwt: JwtService,
    config: ConfigService,
    private readonly principals: AuthPrincipalService,
  ) {
    // Domain-separated signing key: tickets cannot authenticate REST requests.
    this.secret = createHmac(
      "sha256",
      config.getOrThrow<string>("JWT_ACCESS_SECRET"),
    )
      .update(AUDIENCE)
      .digest("hex");
  }

  async issue(accessToken: string) {
    const claims = await this.jwt.verifyAsync<VerifiedClaims>(accessToken);
    const { id, expiresAtMs } = this.principals.validateVerifiedClaims(claims);
    await this.principals.resolveActive(id);
    const sessionExp = Math.floor(expiresAtMs / 1000);
    const exp = Math.min(sessionExp, Math.floor(Date.now() / 1000) + 60);
    const ticket = await this.jwt.signAsync(
      { id, sub: id, scope: "socket", sessionExp, exp },
      { secret: this.secret, audience: AUDIENCE, algorithm: "HS256" },
    );
    return {
      ticket,
      expiresAt: new Date(exp * 1000).toISOString(),
      sessionExpiresAt: new Date(expiresAtMs).toISOString(),
    };
  }

  async verify(raw: string): Promise<VerifiedClaims> {
    let ticket: TicketClaims;
    try {
      ticket = await this.jwt.verifyAsync<TicketClaims>(raw, {
        secret: this.secret,
        audience: AUDIENCE,
        algorithms: ["HS256"],
      });
    } catch {
      // Preserve the existing access-JWT handshake for other clients.
      return this.jwt.verifyAsync<VerifiedClaims>(raw);
    }
    if (
      ticket.scope !== "socket" ||
      typeof ticket.sessionExp !== "number" ||
      typeof ticket.exp !== "number" ||
      ticket.sessionExp < ticket.exp
    ) {
      throw new UnauthorizedException("Invalid socket ticket");
    }
    // Ticket exp limits new handshakes; sessionExp limits an established socket.
    const claims = { id: ticket.id, sub: ticket.sub, exp: ticket.sessionExp };
    this.principals.validateVerifiedClaims(claims);
    return claims;
  }
}
