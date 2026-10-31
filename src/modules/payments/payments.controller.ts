import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import { IsIn, IsUUID } from "class-validator";
import type { Request, Response } from "express";
import { AuthOnly } from "../authorization/decorators/auth-only.decorator";
import { Public } from "../../common/decorators/customize.decorator";
import { GetAuthorizationContext } from "../authorization/decorators/get-authorization-context.decorator";
import type { AuthenticatedContext } from "../authorization/authorization.types";
import { PaymentsService } from "./payments.service";
class CreateOrder {
  @IsUUID() postId!: string;
  @IsIn(["boost_24h", "boost_48h", "boost_72h"]) packageCode!: string;
}
@Controller("payments")
export class PaymentsController {
  constructor(private service: PaymentsService) {}
  @Get("packages") @AuthOnly() packages() {
    return this.service.packages();
  }
  @Post("orders") @AuthOnly() create(
    @Body() body: CreateOrder,
    @Headers("idempotency-key") key: string,
    @Req() req: Request,
    @GetAuthorizationContext() ctx: AuthenticatedContext,
  ) {
    return this.service.create(
      ctx.principal.id,
      body.postId,
      body.packageCode,
      key,
      req.ip ?? req.socket.remoteAddress ?? "127.0.0.1",
    );
  }
  @Get("orders/by-reference/:ref") @AuthOnly() reference(
    @Param("ref") ref: string,
    @GetAuthorizationContext() ctx: AuthenticatedContext,
  ) {
    return this.service.read(ctx.principal.id, ref, true);
  }
  @Get("checkout/:postId") @AuthOnly() checkout(
    @Param("postId", new ParseUUIDPipe()) postId: string,
    @GetAuthorizationContext() ctx: AuthenticatedContext,
  ) {
    return this.service.checkout(ctx.principal.id, postId);
  }
  @Get("orders/:id") @AuthOnly() read(
    @Param("id", new ParseUUIDPipe()) id: string,
    @GetAuthorizationContext() ctx: AuthenticatedContext,
  ) {
    return this.service.read(ctx.principal.id, id);
  }
  @Post("vnpay/return") @AuthOnly() confirmReturn(
    @Body() body: Record<string, unknown>,
    @GetAuthorizationContext() ctx: AuthenticatedContext,
  ) {
    return this.service.confirmReturn(ctx.principal.id, body);
  }
  @Get("vnpay/ipn") @Public() async ipn(
    @Query() query: Record<string, unknown>,
    @Res() res: Response,
  ) {
    try {
      res.status(200).json(await this.service.ipn(query));
    } catch {
      res.status(200).json({ RspCode: "99", Message: "Processing error" });
    }
  }
}
