import {
  ForbiddenException,
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  InternalServerErrorException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthorizationService } from "../authorization.service";
import { resolveRouteAccess } from "../route-access.resolver";
import { AUTHORIZATION_CONTEXT_REQUEST_KEY } from "../decorators/get-authorization-context.decorator";
import type { UserInterface } from "../../../shared/interfaces/user.interface";

@Injectable()
export class PoliciesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorization: AuthorizationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== "http") return true;
    const handler = context.getHandler();
    const controllerClass = context.getClass();
    const descriptor = resolveRouteAccess(
      this.reflector,
      handler,
      controllerClass,
    );
    const request = context.switchToHttp().getRequest<{
      user?: UserInterface;
      [AUTHORIZATION_CONTEXT_REQUEST_KEY]?: unknown;
    }>();
    if (!descriptor) {
      throw new InternalServerErrorException(
        "Missing route authorization metadata",
      );
    }
    if (descriptor.mode === "public") {
      const guest = this.authorization.createGuestContext();
      request[AUTHORIZATION_CONTEXT_REQUEST_KEY] = guest;
      return true;
    }
    if (descriptor.mode === "authOnly") {
      if (!request.user?.id) {
        throw new UnauthorizedException("Authentication required");
      }
      const ctx = this.authorization.createAuthenticatedContext({
        id: request.user.id.toLowerCase(),
        email: request.user.email,
        fullName: request.user.fullName,
        isAdmin: request.user.isAdmin,
      });
      request[AUTHORIZATION_CONTEXT_REQUEST_KEY] = ctx;
      return true;
    }
    // policy mode: AND over all requirements (route gate on subject type).
    if (!request.user?.id) {
      throw new UnauthorizedException("Authentication required");
    }
    const authCtx = this.authorization.createAuthenticatedContext({
      id: request.user.id.toLowerCase(),
      email: request.user.email,
      fullName: request.user.fullName,
      isAdmin: request.user.isAdmin,
    });
    request[AUTHORIZATION_CONTEXT_REQUEST_KEY] = authCtx;
    for (const req of descriptor.requirements) {
      try {
        this.authorization.assertRoute(authCtx, req.action, req.subject);
      } catch (err) {
        if (err instanceof ForbiddenException) throw err;
        throw new InternalServerErrorException("Authorization check failed");
      }
    }
    return true;
  }
}
