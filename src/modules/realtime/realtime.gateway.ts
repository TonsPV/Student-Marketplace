import { JwtService } from "@nestjs/jwt";
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { Namespace, Socket } from "socket.io";
import { UserInterface } from "../../shared/interfaces/user.interface";
import { userRoom } from "./realtime.events";
import { RealtimeService } from "./realtime.service";

export type AuthSocket = Socket & {
  data: { user: Pick<UserInterface, "id" | "email"> };
};

@WebSocketGateway({ namespace: "/ws" })
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server!: Namespace;

  constructor(
    private jwt: JwtService,
    private realtime: RealtimeService,
  ) {}

  afterInit(server: Namespace) {
    this.realtime.bindServer(server);
    // Xác thực ngay lúc handshake, nếu fail thì client nhận 'connect_error'
    server.use(async (socket, next) => {
      try {
        const raw =
          socket.handshake.auth?.token ??
          socket.handshake.headers.authorization?.replace(/^Bearer\s+/i, "");
        if (!raw) return next(new Error("UNAUTHORIZED"));
        const payload = await this.jwt.verifyAsync<UserInterface>(raw);
        socket.data.user = { id: payload.id, email: payload.email };
        next();
      } catch {
        next(new Error("UNAUTHORIZED"));
      }
    });
  }

  async handleConnection(client: AuthSocket) {
    const { id } = client.data.user;
    await client.join(userRoom(id));
    this.realtime.markOnline(id);
  }

  handleDisconnect(client: AuthSocket) {
    if (client.data.user) this.realtime.markOffline(client.data.user.id);
  }
}
