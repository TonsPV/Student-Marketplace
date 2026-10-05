import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { UserEntity } from "../../modules/user/user.entity";

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<{ user?: { id: string } }>();
    if (!request.user?.id)
      throw new UnauthorizedException("Authentication required");
    const user = await this.users.findOneBy({ id: request.user.id });
    if (!user || user.isLocked || !user.isAdmin)
      throw new ForbiddenException("Admin access required");
    return true;
  }
}
