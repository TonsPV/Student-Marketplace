import {
  createParamDecorator,
  ExecutionContext,
  InternalServerErrorException,
} from "@nestjs/common";
import type { AuthorizationContext } from "../authorization.types";

export const AUTHORIZATION_CONTEXT_REQUEST_KEY = "authorizationContext";

export const GetAuthorizationContext = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthorizationContext => {
    const request = ctx.switchToHttp().getRequest<{
      [AUTHORIZATION_CONTEXT_REQUEST_KEY]?: AuthorizationContext;
    }>();
    const context = request[AUTHORIZATION_CONTEXT_REQUEST_KEY];
    if (!context) {
      throw new InternalServerErrorException(
        "Authorization context is not available",
      );
    }
    return context;
  },
);
