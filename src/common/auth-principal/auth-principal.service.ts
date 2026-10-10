import { Injectable, UnauthorizedException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { isUUID as isUuid } from "class-validator";
import { Repository, EntityManager } from "typeorm";
import { UserEntity } from "../../modules/user/user.entity";
import type { AuthenticatedPrincipal } from "../../modules/authorization/authorization.types";

export interface VerifiedClaims {
  id?: unknown;
  sub?: unknown;
  exp?: unknown;
  email?: unknown;
}

@Injectable()
export class AuthPrincipalService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
  ) {}

  async resolveActive(
    userId: string,
    manager?: EntityManager,
  ): Promise<AuthenticatedPrincipal> {
    const normalized = userId.toLowerCase();
    if (!isUuid(normalized)) {
      throw new UnauthorizedException("Invalid account");
    }
    const repo = manager
      ? manager.getRepository(UserEntity)
      : this.usersRepository;
    let user: UserEntity | null;
    try {
      user = await repo.findOne({
        where: { id: normalized },
        select: {
          id: true,
          email: true,
          fullName: true,
          isAdmin: true,
          isLocked: true,
        },
      });
    } catch (err) {
      throw err;
    }
    if (!user || user.isLocked) {
      throw new UnauthorizedException("Account is locked or no longer exists");
    }
    return {
      id: user.id.toLowerCase(),
      email: user.email,
      fullName: user.fullName,
      isAdmin: user.isAdmin,
    };
  }

  async resolveFromVerifiedClaims(
    claims: VerifiedClaims,
  ): Promise<AuthenticatedPrincipal> {
    const { id } = this.validateVerifiedClaims(claims);
    return this.resolveActive(id);
  }

  validateVerifiedClaims(claims: VerifiedClaims): {
    id: string;
    expiresAtMs: number;
  } {
    const rawId = claims.id;
    if (typeof rawId !== "string" || !isUuid(rawId)) {
      throw new UnauthorizedException("Invalid token!");
    }
    const id = rawId.toLowerCase();
    const exp = claims.exp;
    if (
      typeof exp !== "number" ||
      !Number.isFinite(exp) ||
      !Number.isFinite(exp * 1000) ||
      exp * 1000 <= Date.now()
    ) {
      throw new UnauthorizedException("Invalid token!");
    }
    if (claims.sub !== undefined) {
      if (typeof claims.sub !== "string" || claims.sub.toLowerCase() !== id) {
        throw new UnauthorizedException("Invalid token!");
      }
    }
    return { id, expiresAtMs: exp * 1000 };
  }
}
