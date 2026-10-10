import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, EntityManager, In, MoreThan, Repository } from "typeorm";
import { uuidv7 } from "uuidv7";
import { UserEntity } from "../../user/user.entity";
import { MailService } from "../../mailer/mail.service";
import { RefreshTokenService } from "../../refresh-token/refresh-token.service";
import { PasswordService } from "./password.service";
import { PasswordResetChallengeEntity } from "../password-reset-challenge.entity";
import { ResetPasswordDto } from "../dto/reset-password.dto";
import {
  createOtp,
  createResetToken,
  hashOtp,
  hashResetToken,
  otpMatches,
} from "./password-reset.crypto";

const OPEN_STATUSES = ["pending", "active", "verified"] as const;
const OTP_TTL_MS = 10 * 60 * 1000;
const TOKEN_TTL_MS = 5 * 60 * 1000;
const INVALID_OTP = "Reset code is invalid or expired";
const INVALID_TOKEN = "Reset token is invalid or expired";

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);
  private readonly secret: string;

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(PasswordResetChallengeEntity)
    private readonly challenges: Repository<PasswordResetChallengeEntity>,
    config: ConfigService,
    private readonly mail: MailService,
    private readonly passwords: PasswordService,
    private readonly refreshTokens: RefreshTokenService,
  ) {
    this.secret = config.getOrThrow<string>("PASSWORD_RESET_SECRET");
    if (Buffer.byteLength(this.secret, "utf8") < 32)
      throw new Error("PASSWORD_RESET_SECRET must contain at least 32 bytes");
  }

  private lockUser(manager: EntityManager, userId: string) {
    return manager
      .getRepository(UserEntity)
      .createQueryBuilder("u")
      .setLock("pessimistic_write")
      .where("u.id = :id", { id: userId })
      .getOne();
  }

  private invalidate(manager: EntityManager, userId: string) {
    return manager
      .getRepository(PasswordResetChallengeEntity)
      .update(
        { userId, status: In([...OPEN_STATUSES]) },
        { status: "invalidated", otpHash: null, resetTokenHash: null },
      );
  }

  async requestReset(email: string): Promise<{ requested: true }> {
    const candidate = await this.dataSource
      .getRepository(UserEntity)
      .findOneBy({ email });
    if (!candidate || candidate.isLocked) return { requested: true };
    const prepared = await this.dataSource.transaction(async (manager) => {
      const user = await this.lockUser(manager, candidate.id);
      if (!user || user.isLocked || user.email !== email) return null;
      const repo = manager.getRepository(PasswordResetChallengeEntity);
      const now = new Date();
      const latest = await repo.findOne({
        where: { userId: user.id },
        order: { createdAt: "DESC" },
      });
      if (latest && now.getTime() - latest.createdAt.getTime() < 60000)
        return null;
      const count = await repo.countBy({
        userId: user.id,
        createdAt: MoreThan(new Date(now.getTime() - 3600000)),
      });
      if (count >= 5) return null;
      await this.invalidate(manager, user.id);
      const id = uuidv7();
      const otp = createOtp();
      await repo.save(
        repo.create({
          id,
          userId: user.id,
          otpHash: hashOtp(this.secret, id, otp),
          otpExpiresAt: new Date(now.getTime() + OTP_TTL_MS),
          createdAt: now,
          status: "pending",
          failedAttempts: 0,
        }),
      );
      return { id, user, otp };
    });
    if (!prepared) return { requested: true };

    // Never hold a database transaction across an SMTP network call.
    try {
      await this.mail.sendResetPasswordOtp({
        email: prepared.user.email,
        fullName: prepared.user.fullName,
        otp: prepared.otp,
      });
    } catch {
      await this.challenges.update(
        { id: prepared.id, status: "pending" },
        { status: "failed", otpHash: null },
      );
      this.logger.warn(`Reset OTP send failed; challenge=${prepared.id}`);
      return { requested: true };
    }
    // A newer request may have invalidated this challenge while SMTP was running.
    await this.challenges.update(
      {
        id: prepared.id,
        status: "pending",
        otpExpiresAt: MoreThan(new Date()),
      },
      { status: "active" },
    );
    return { requested: true };
  }

  async verifyOtp(
    email: string,
    otp: string,
  ): Promise<{ resetToken: string; expiresAt: string }> {
    const candidate = await this.dataSource
      .getRepository(UserEntity)
      .findOneBy({ email });
    if (!candidate || candidate.isLocked)
      throw new BadRequestException(INVALID_OTP);
    const outcome = await this.dataSource.transaction(async (manager) => {
      const user = await this.lockUser(manager, candidate.id);
      if (!user || user.isLocked || user.email !== email) return null;
      const repo = manager.getRepository(PasswordResetChallengeEntity);
      const challenge = await repo.findOne({
        where: { userId: user.id, status: "active" },
        order: { createdAt: "DESC" },
        lock: { mode: "pessimistic_write" },
      });
      if (
        !challenge ||
        !challenge.otpHash ||
        challenge.failedAttempts >= 5 ||
        challenge.otpExpiresAt.getTime() <= Date.now()
      )
        return null;
      if (!otpMatches(this.secret, challenge.id, otp, challenge.otpHash)) {
        challenge.failedAttempts += 1;
        if (challenge.failedAttempts >= 5) {
          challenge.status = "invalidated";
          challenge.otpHash = null;
        }
        await repo.save(challenge);
        // Throw outside the transaction so the failed attempt is committed.
        return null;
      }
      const resetToken = createResetToken();
      challenge.status = "verified";
      challenge.otpHash = null;
      challenge.resetTokenHash = hashResetToken(resetToken);
      challenge.resetTokenExpiresAt = new Date(Date.now() + TOKEN_TTL_MS);
      await repo.save(challenge);
      return {
        resetToken,
        expiresAt: challenge.resetTokenExpiresAt.toISOString(),
      };
    });
    if (!outcome) throw new BadRequestException(INVALID_OTP);
    return outcome;
  }

  async resetPassword(dto: ResetPasswordDto): Promise<{ changed: true }> {
    if (dto.newPassword !== dto.confirmPassword)
      throw new BadRequestException("Password confirmation does not match");
    if (
      dto.newPassword.length < 8 ||
      Buffer.byteLength(dto.newPassword, "utf8") > 72
    )
      throw new BadRequestException(
        "Password must contain at least 8 characters and at most 72 UTF-8 bytes",
      );
    const tokenHash = hashResetToken(dto.resetToken);
    const candidate = await this.challenges.findOneBy({
      resetTokenHash: tokenHash,
      status: "verified",
    });
    if (!candidate) throw new BadRequestException(INVALID_TOKEN);
    // Hash outside the transaction to keep row lock duration short.
    const password = this.passwords.getHashPassword(dto.newPassword);
    const user = await this.dataSource.transaction(async (manager) => {
      const user = await this.lockUser(manager, candidate.userId);
      if (!user || user.isLocked) throw new BadRequestException(INVALID_TOKEN);
      const repo = manager.getRepository(PasswordResetChallengeEntity);
      const challenge = await repo.findOne({
        where: {
          id: candidate.id,
          userId: user.id,
          resetTokenHash: tokenHash,
          status: "verified",
        },
        lock: { mode: "pessimistic_write" },
      });
      if (
        !challenge?.resetTokenExpiresAt ||
        challenge.resetTokenExpiresAt.getTime() <= Date.now()
      )
        throw new BadRequestException(INVALID_TOKEN);
      await manager.update(UserEntity, user.id, { password });
      await repo.update(challenge.id, {
        status: "consumed",
        consumedAt: new Date(),
        resetTokenHash: null,
        otpHash: null,
      });
      await this.invalidate(manager, user.id);
      await this.refreshTokens.revokeAllRefreshTokensForUser(user.id, manager);
      return user;
    });
    try {
      await this.mail.sendPasswordChanged({
        email: user.email,
        fullName: user.fullName,
      });
    } catch {
      this.logger.warn(
        `Password changed notification failed; challenge=${candidate.id}`,
      );
    }
    return { changed: true };
  }

  async cleanupExpiredChallenges(): Promise<{ count: number }> {
    // Retain 24 hours for diagnostics and the one-hour resend quota.
    const result = await this.challenges
      .createQueryBuilder()
      .delete()
      .where("created_at < :cutoff", {
        cutoff: new Date(Date.now() - 24 * 3600000),
      })
      .andWhere(
        "(status IN (:...closed) OR (otp_expires_at <= :now AND (reset_token_expires_at IS NULL OR reset_token_expires_at <= :now)))",
        {
          closed: ["consumed", "invalidated", "failed"],
          now: new Date(),
        },
      )
      .execute();
    return { count: result.affected ?? 0 };
  }
}
