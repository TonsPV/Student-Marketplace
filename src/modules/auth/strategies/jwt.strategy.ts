import { ExtractJwt, Strategy } from "passport-jwt";
import { PassportStrategy } from "@nestjs/passport";
import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { UserInterface } from "../../../shared/interfaces/user.interface";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { UserEntity } from "../../user/user.entity";
import { TokenPayload } from "../../refresh-token/refresh-token.type";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
  ) {
    const secret = configService.get<string>("JWT_ACCESS_SECRET");
    if (!secret) {
      throw new Error("JWT_ACCESS_SECRET is not defined");
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: TokenPayload): Promise<UserInterface> {
    const user = await this.usersRepository.findOne({
      where: { id: payload.id },
      select: {
        id: true,
        email: true,
        fullName: true,
        isAdmin: true,
        isLocked: true,
      },
    });

    if (!user || user.isLocked) {
      throw new UnauthorizedException("Account is locked or no longer exists");
    }

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      isAdmin: user.isAdmin,
    };
  }
}
