import { ExtractJwt, Strategy } from "passport-jwt";
import { PassportStrategy } from "@nestjs/passport";
import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { UserInterface } from "../../../shared/interfaces/user.interface";
import { AuthPrincipalService } from "../../../common/auth-principal/auth-principal.service";
import { TokenPayload } from "../../refresh-token/refresh-token.type";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private readonly principal: AuthPrincipalService,
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
    const exp = (payload as unknown as { exp?: unknown }).exp;
    if (
      typeof exp !== "number" ||
      !Number.isFinite(exp) ||
      exp * 1000 <= Date.now()
    ) {
      throw new UnauthorizedException("Invalid token!");
    }
    const sub = (payload as unknown as { sub?: unknown }).sub;
    if (
      typeof payload.id !== "string" ||
      (sub !== undefined &&
        sub !== null &&
        String(sub).toLowerCase() !== payload.id.toLowerCase())
    ) {
      throw new UnauthorizedException("Invalid token!");
    }
    try {
      return await this.principal.resolveActive(payload.id);
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw err;
    }
  }
}
