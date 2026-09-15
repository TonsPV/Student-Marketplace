import { BadRequestException, Injectable, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import ms, { StringValue } from 'ms';
import { RefreshTokenPayload, TokenPayload } from "./refresh-token.type";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, Not, LessThan, MoreThan } from "typeorm";
import { DeviceInfo, RefreshTokenEntity } from "./refresh-token.entity";
import { UserEntity } from "../user/user.entity";
import { createHash } from 'crypto';
import { uuidv7 } from 'uuidv7';



@Injectable()
export class RefreshTokenService implements OnModuleInit {
  private accessSecret!: string;
  private accessExpiresIn!: StringValue;
  private refreshSecret!: string;
  private refreshExpiresIn!: StringValue;
  private refreshExpiresInMs!: number;

  constructor(
    @InjectRepository(RefreshTokenEntity)
    private tokenRepository: Repository<RefreshTokenEntity>,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) { }

  onModuleInit() {
    const accessSecret = this.configService.get<string>('JWT_ACCESS_SECRET');
    const accessExpiresIn = this.configService.get<string>(
      'JWT_ACCESS_EXPIRED',
    ) as StringValue | undefined;
    const refreshSecret = this.configService.get<string>('JWT_REFRESH_SECRET');
    const refreshExpiresIn = this.configService.get<string>(
      'JWT_REFRESH_EXPIRED',
    ) as StringValue | undefined;
    const refreshExpiresInMs = refreshExpiresIn
      ? ms(refreshExpiresIn)
      : undefined;

    if (
      !accessSecret ||
      !accessExpiresIn ||
      !refreshSecret ||
      !refreshExpiresIn ||
      typeof refreshExpiresInMs !== 'number'
    ) {
      throw new Error('JWT token config is invalid');
    }

    this.accessSecret = accessSecret;
    this.accessExpiresIn = accessExpiresIn;
    this.refreshSecret = refreshSecret;
    this.refreshExpiresIn = refreshExpiresIn;
    this.refreshExpiresInMs = refreshExpiresInMs;
  }

  createRefreshToken(payload: TokenPayload) {
    return this.jwtService.sign(payload, {
      jwtid: uuidv7(),
      secret: this.refreshSecret,
      expiresIn: this.refreshExpiresIn,
    });
  }

  createAccessToken(payload: TokenPayload) {
    return this.jwtService.sign(payload, {
      secret: this.accessSecret,
      expiresIn: this.accessExpiresIn,
    });
  }

  async processToken(refreshToken: string) {
    let payload: RefreshTokenPayload;
    try {
      payload = this.jwtService.verify<RefreshTokenPayload>(
        refreshToken,
        {
          secret: this.refreshSecret,
        },
      );
    } catch {
      throw new BadRequestException('Refresh token invalid!');
    }

    const tokenHash = this.hashToken(refreshToken);
    const storedToken = await this.findValidToken(tokenHash);

    if (!storedToken || !storedToken.user || storedToken.user.isLocked || storedToken.user.id !== payload.id) {
      throw new BadRequestException('Refresh token invalid!');
    }

    const newPayload: TokenPayload = {
      sub: payload.id,
      iss: 'Backend-core',
      id: payload.id,
      email: storedToken.user.email,
    };

    const newRefreshToken = this.createRefreshToken(newPayload);
    const newRefreshTokenHash = this.hashToken(newRefreshToken);

    await this.rotateToken({
      oldTokenId: storedToken.id,
      userId: payload.id,
      newTokenHash: newRefreshTokenHash,
      expiresAt: this.getRefreshTokenExpiresAt(),
    });

    return {
      accessToken: this.createAccessToken(newPayload),
      refreshToken: newRefreshToken,
      user: {
        id: payload.id,
        email: storedToken.user.email,
      },
    };
  }

  hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  getRefreshTokenExpiresAt() {
    return new Date(Date.now() + this.refreshExpiresInMs);
  }

  getRefreshTokenMaxAge() {
    return this.refreshExpiresInMs;
  }

  async revokeRefreshToken(refreshToken: string) {
    return this.revokeToken(this.hashToken(refreshToken));
  }

  async revokeOtherRefreshTokensForUser(
    userId: string,
    currentTokenHash: string,
  ) {
    const result = await this.tokenRepository.update(
      {
        user: { id: userId },
        isRevoked: false,
        tokenHash: Not(currentTokenHash),
      },
      { isRevoked: true },
    );
    return { count: result.affected ?? 0 };
  }

  async cleanupInactiveRefreshTokens() {
    const result = await this.tokenRepository.delete([
      { expiresAt: LessThan(new Date()) },
      { isRevoked: true },
    ]);
    return { count: result.affected ?? 0 };
  }

  async findValidToken(tokenHash: string) {
    return this.tokenRepository.findOne({
      where: {
        tokenHash: tokenHash,
        isRevoked: false,
        expiresAt: MoreThan(new Date()),
      },
      relations: { user: true },
      order: { createdAt: 'DESC' },
    });
  }

  async rotateToken(data: {
    oldTokenId: string;
    userId: string;
    newTokenHash: string;
    expiresAt: Date;
  }) {
    return this.tokenRepository.manager.transaction(async (em) => {
      const repo = em.getRepository(RefreshTokenEntity);
      const oldToken = await repo.findOne({
        where: { id: data.oldTokenId },
        select: { id: true, deviceInfo: true },
      });

      if (!oldToken) {
        throw new BadRequestException('Refresh token invalid!');
      }

      const result = await repo.update(
        { id: data.oldTokenId, isRevoked: false, expiresAt: MoreThan(new Date()) },
        { isRevoked: true },
      );

      if (result.affected !== 1) {
        throw new BadRequestException('Refresh token invalid!');
      }

      return repo.save(
        repo.create({
          id: uuidv7(),
          user: { id: data.userId } as UserEntity,
          tokenHash: data.newTokenHash,
          expiresAt: data.expiresAt,
          deviceInfo: oldToken.deviceInfo ?? null,
        }),
      );
    });
  }

  // Thu hồi token
  async revokeToken(tokenHash: string) {
    const result = await this.tokenRepository.update(
      { tokenHash, isRevoked: false },
      { isRevoked: true },
    );
    return { count: result.affected ?? 0 };
  }

  async createRefreshTokenRecord(data: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    deviceInfo?: DeviceInfo;
  }) {
    const token = this.tokenRepository.create({
      user: { id: data.userId },
      tokenHash: data.tokenHash,
      expiresAt: data.expiresAt,
      deviceInfo: data.deviceInfo ?? null,
    });
    return await this.tokenRepository.save(token);
  }

  async queryUserIdByToken(refreshToken: string) {
    const record = await this.tokenRepository.findOne({
      where: { tokenHash: refreshToken },
      relations: { user: true },
    });
    return record?.user.id;
  }
}
