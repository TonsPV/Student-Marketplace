import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { UserInterface } from "../../shared/interfaces/user.interface";

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<{ user?: UserInterface }>();
    if (!request.user?.id)
      throw new UnauthorizedException("Authentication required");
    if (!request.user.isAdmin)
      throw new ForbiddenException("Admin access required");
    return true;
  }
}
