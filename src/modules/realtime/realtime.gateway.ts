import { Logger, UnauthorizedException } from "@nestjs/common";
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { Namespace, Socket } from "socket.io";
import {
  AuthPrincipalService,
  type VerifiedClaims,
} from "../../common/auth-principal/auth-principal.service";
import { SessionRegistryService } from "../../common/session-registry/session-registry.service";
import type { AuthenticatedPrincipal } from "../authorization/authorization.types";
import { userRoom } from "./realtime.events";
import { RealtimeService } from "./realtime.service";
import { SocketTicketService } from "./socket-ticket.service";

export type AuthSocket = Socket & {
  data: { user?: AuthenticatedPrincipal; presenceRegistered?: boolean };
};
@WebSocketGateway({ namespace: "/ws" })
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server!: Namespace;
  private readonly logger = new Logger(RealtimeGateway.name);
  constructor(
    private readonly tickets: SocketTicketService,
    private readonly realtime: RealtimeService,
    private readonly principals: AuthPrincipalService,
    private readonly sessions: SessionRegistryService,
  ) {}
  afterInit(server: Namespace) {
    this.realtime.bindServer(server);
    server.use(async (socket, next) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        if (error) this.sessions.remove(socket.id);
        next(error);
      };
      socket.conn.once("close", () => {
        this.sessions.remove(socket.id);
        finish(new Error("UNAUTHORIZED"));
      });
      let claims: VerifiedClaims;
      try {
        const raw =
          socket.handshake.auth?.token ??
          socket.handshake.headers.authorization?.replace(/^Bearer\s+/i, "");
        if (typeof raw !== "string" || !raw) throw new UnauthorizedException();
        claims = await this.tickets.verify(raw);
        const { id, expiresAtMs } =
          this.principals.validateVerifiedClaims(claims);
        if (settled || socket.conn.readyState !== "open")
          return finish(new Error("UNAUTHORIZED"));
        this.sessions.registerPending(socket, id, expiresAtMs, (reason) =>
          finish(new Error(reason)),
        );
      } catch {
        return finish(new Error("UNAUTHORIZED"));
      }
      try {
        const principal =
          await this.principals.resolveFromVerifiedClaims(claims);
        if (settled || !this.sessions.isCurrent(socket.id))
          return finish(new Error("UNAUTHORIZED"));
        socket.data.user = principal;
        finish();
      } catch (error) {
        if (!(error instanceof UnauthorizedException))
          this.logger.error("WebSocket principal lookup failed");
        finish(
          new Error(
            error instanceof UnauthorizedException
              ? "UNAUTHORIZED"
              : "INTERNAL_ERROR",
          ),
        );
      }
    });
  }
  async handleConnection(client: AuthSocket) {
    const record = this.sessions.activate(client.id);
    if (!record || !client.data.user) {
      this.sessions.markInvalid(client.id);
      client.disconnect(true);
      return;
    }
    try {
      await client.join(userRoom(record.userId));
      if (!this.sessions.isEligible(client.id)) {
        client.disconnect(true);
        return;
      }
      client.data.presenceRegistered = true;
      this.realtime.markOnline(record.userId);
    } catch {
      this.sessions.markInvalid(client.id);
    }
  }
  handleDisconnect(client: AuthSocket) {
    this.sessions.remove(client.id);
    if (client.data.presenceRegistered && client.data.user) {
      client.data.presenceRegistered = false;
      this.realtime.markOffline(client.data.user.id);
    }
  }
}
