import {
  applyDecorators,
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from "@nestjs/common";
import { Request } from "express";
import { UserInterface } from "../../shared/interfaces/user.interface";

import { declareRouteAccess } from "../../modules/authorization/route-access.resolver";

export const IS_PUBLIC_KEY = "isPublic";
export const AUTHORIZATION_ROUTE_KEY_LEGACY = "authorization:route";
export const Public = () =>
  applyDecorators(
    SetMetadata(IS_PUBLIC_KEY, true),
    declareRouteAccess({ mode: "public" }),
  );

export const GetUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<
      Request & {
        user?: UserInterface;
      }
    >();
    return request.user;
  },
);

export const RESPONSE_MESSAGE = "response_message";
export const ResponseMessage = (message: string) =>
  SetMetadata(RESPONSE_MESSAGE, message);
