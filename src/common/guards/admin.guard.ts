import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Request } from "express";
import { UserService } from "../../modules/user/user.service";
import { UserInterface } from "../../shared/interfaces/user.interface";

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly userService: UserService) {}

  async canActivate(context: ExecutionContext) {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: UserInterface }>();

    if (!request.user || !(await this.userService.isAdmin(request.user.id))) {
      throw new ForbiddenException("Admin access required");
    }

    return true;
  }
}
