import { Controller, Post, Req, UnauthorizedException } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Request } from "express";
import { AuthOnly } from "../authorization/decorators/auth-only.decorator";
import { SocketTicketService } from "./socket-ticket.service";

@ApiTags("Realtime")
@ApiBearerAuth("access-token")
@Controller("realtime")
export class SocketTicketController {
  constructor(private readonly tickets: SocketTicketService) {}
  @Post("socket-ticket")
  @AuthOnly()
  issue(@Req() request: Request) {
    const token =
      request.headers.authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
    if (!token) throw new UnauthorizedException();
    return this.tickets.issue(token);
  }
}
