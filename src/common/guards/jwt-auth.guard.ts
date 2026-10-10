import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthGuard } from "@nestjs/passport";
import { resolveRouteAccess } from "../../modules/authorization/route-access.resolver";
import { UserInterface } from "../../shared/interfaces/user.interface";

@Injectable()
export class JwtAuthGuard extends AuthGuard("jwt") {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    if (context.getType() !== "http") return true;
    const descriptor = resolveRouteAccess(
      this.reflector,
      context.getHandler(),
      context.getClass(),
    );
    if (descriptor?.mode === "public") {
      return true;
    }
    return super.canActivate(context);
  }

  handleRequest<TUser = UserInterface>(
    err: Error | null,
    user: TUser | false | null,
  ): TUser {
    // You can throw an exception based on either "info" or "err" arguments
    if (err || !user) {
      throw err || new UnauthorizedException("Invalid token!");
    }
    return user;
  }
}
