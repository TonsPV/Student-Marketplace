import "reflect-metadata";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { DataSource } from "typeorm";
import { hashSync } from "bcryptjs";
import { uuidv7 } from "uuidv7";
import { PasswordResetService } from "../../src/modules/auth/services/password-reset.service";
import { PasswordService } from "../../src/modules/auth/services/password.service";
import { PasswordResetChallengeEntity } from "../../src/modules/auth/password-reset-challenge.entity";
import {
  hashOtp,
  hashResetToken,
  createResetToken,
} from "../../src/modules/auth/services/password-reset.crypto";
import { MailService } from "../../src/modules/mailer/mail.service";
import { RefreshTokenService } from "../../src/modules/refresh-token/refresh-token.service";
import { RefreshTokenEntity } from "../../src/modules/refresh-token/refresh-token.entity";
import { UserEntity } from "../../src/modules/user/user.entity";
import { UserService } from "../../src/modules/user/user.service";
import {
  createTestDataSource,
  initializeTestDatabase,
  disposeTestDatabase,
} from "./database";
import { cleanFixtures, createTestUser } from "./fixtures";

describe("PostgreSQL password reset lifecycle", () => {
  let ds: DataSource,
    service: PasswordResetService,
    user: UserEntity,
    refresh: RefreshTokenService;
  const secret = "password-reset-test-secret-not-for-production";
  const passwords = new PasswordService({} as UserService);
  const mail = {
    sendResetPasswordOtp: jest.fn(),
    sendPasswordChanged: jest.fn(),
  };
  const repo = () => ds.getRepository(PasswordResetChallengeEntity);
  const latest = () =>
    repo().findOneOrFail({
      where: { userId: user.id },
      order: { createdAt: "DESC" },
    });
  const sentOtp = () =>
    mail.sendResetPasswordOtp.mock.calls.at(-1)![0].otp as string;
  const input = (resetToken: string, password = "new-password-123") => ({
    resetToken,
    newPassword: password,
    confirmPassword: password,
  });
  async function verified() {
    await service.requestReset(user.email);
    return service.verifyOtp(user.email, sentOtp());
  }
  async function allowResend() {
    await repo().update((await latest()).id, {
      createdAt: new Date(Date.now() - 61000),
    });
  }
  beforeAll(async () => {
    ds = createTestDataSource();
    await initializeTestDatabase(ds);
    refresh = new RefreshTokenService(
      ds.getRepository(RefreshTokenEntity),
      new JwtService(),
      new ConfigService({
        JWT_ACCESS_SECRET: "test-access-secret",
        JWT_ACCESS_EXPIRED: "15m",
        JWT_REFRESH_SECRET: "test-refresh-secret",
        JWT_REFRESH_EXPIRED: "7d",
      }),
      ds,
    );
    refresh.onModuleInit();
    service = new PasswordResetService(
      ds,
      repo(),
      new ConfigService({ PASSWORD_RESET_SECRET: secret }),
      mail as unknown as MailService,
      passwords,
      refresh,
    );
  });
  beforeEach(async () => {
    await cleanFixtures(ds);
    mail.sendResetPasswordOtp.mockReset().mockResolvedValue(undefined);
    mail.sendPasswordChanged.mockReset().mockResolvedValue(undefined);
    user = await createTestUser(ds, {
      password: hashSync("old-password-123", 10),
    });
  });
  afterAll(async () => {
    if (ds) await disposeTestDatabase(ds);
  });

  it("stores only hashes, exchanges the OTP once, changes password and revokes refresh tokens", async () => {
    const refreshToken = refresh.createRefreshToken({
      id: user.id,
      sub: user.id,
      iss: "Backend-core",
      email: user.email,
      isAdmin: false,
    });
    await refresh.createRefreshTokenRecord({
      userId: user.id,
      tokenHash: refresh.hashToken(refreshToken),
      expiresAt: refresh.getRefreshTokenExpiresAt(),
    });
    await service.requestReset(user.email);
    const challenge = await latest();
    expect(challenge.status).toBe("active");
    expect(challenge.otpHash).toBe(hashOtp(secret, challenge.id, sentOtp()));
    expect(
      challenge.otpExpiresAt.getTime() - challenge.createdAt.getTime(),
    ).toBe(600000);
    const result = await service.verifyOtp(user.email, sentOtp());
    expect((await latest()).otpHash).toBeNull();
    expect((await latest()).resetTokenHash).toBe(
      hashResetToken(result.resetToken),
    );
    await expect(service.verifyOtp(user.email, sentOtp())).rejects.toThrow(
      "invalid or expired",
    );
    expect(await service.resetPassword(input(result.resetToken))).toEqual({
      changed: true,
    });
    const updated = await ds
      .getRepository(UserEntity)
      .findOneByOrFail({ id: user.id });
    expect(
      await passwords.isValidPassword("new-password-123", updated.password),
    ).toBe(true);
    expect(
      await passwords.isValidPassword("old-password-123", updated.password),
    ).toBe(false);
    expect((await latest()).status).toBe("consumed");
    expect((await latest()).resetTokenHash).toBeNull();
    await expect(refresh.processToken(refreshToken)).rejects.toThrow(
      "Refresh token invalid",
    );
    await expect(
      service.resetPassword(input(result.resetToken)),
    ).rejects.toThrow("invalid or expired");
    expect(mail.sendPasswordChanged).toHaveBeenCalledWith({
      email: user.email,
      fullName: user.fullName,
    });
  });
  it("persists failed attempts on rejected requests and stops after five", async () => {
    await service.requestReset(user.email);
    const wrong = sentOtp() === "000000" ? "111111" : "000000";
    for (let attempt = 1; attempt <= 5; attempt++) {
      await expect(service.verifyOtp(user.email, wrong)).rejects.toThrow(
        "invalid or expired",
      );
      expect((await latest()).failedAttempts).toBe(attempt);
    }
    expect((await latest()).status).toBe("invalidated");
    await expect(service.verifyOtp(user.email, sentOtp())).rejects.toThrow(
      "invalid or expired",
    );
  });
  it("retains challenge state when the service instance is recreated", async () => {
    await service.requestReset(user.email);
    const restarted = new PasswordResetService(
      ds,
      repo(),
      new ConfigService({ PASSWORD_RESET_SECRET: secret }),
      mail as unknown as MailService,
      passwords,
      refresh,
    );
    const { resetToken } = await restarted.verifyOtp(user.email, sentOtp());
    await expect(restarted.resetPassword(input(resetToken))).resolves.toEqual({
      changed: true,
    });
  });
  it("serializes verification against resend without leaving an old usable reset token", async () => {
    await service.requestReset(user.email);
    const old = await latest();
    const otp = sentOtp();
    await allowResend();
    const outcomes = await Promise.allSettled([
      service.verifyOtp(user.email, otp),
      service.requestReset(user.email),
    ]);
    expect(outcomes[1].status).toBe("fulfilled");
    expect((await repo().findOneByOrFail({ id: old.id })).status).toBe(
      "invalidated",
    );
    if (
      outcomes[0].status === "fulfilled" &&
      "resetToken" in outcomes[0].value
    ) {
      await expect(
        service.resetPassword(input(outcomes[0].value.resetToken)),
      ).rejects.toThrow("invalid or expired");
    }
    expect((await latest()).status).toBe("active");
  });
  it("rejects expired OTPs and reset tokens without relying on cleanup", async () => {
    await service.requestReset(user.email);
    await repo().update((await latest()).id, {
      otpExpiresAt: new Date(Date.now() - 1),
    });
    await expect(service.verifyOtp(user.email, sentOtp())).rejects.toThrow(
      "invalid or expired",
    );
    await allowResend();
    const { resetToken } = await verified();
    await repo().update((await latest()).id, {
      resetTokenExpiresAt: new Date(Date.now() - 1),
    });
    await expect(service.resetPassword(input(resetToken))).rejects.toThrow(
      "invalid or expired",
    );
  });
  it("suppresses cooldown requests without invalidating the current token", async () => {
    const { resetToken } = await verified();
    await service.requestReset(user.email);
    expect(mail.sendResetPasswordOtp).toHaveBeenCalledTimes(1);
    await expect(service.resetPassword(input(resetToken))).resolves.toEqual({
      changed: true,
    });
  });
  it("invalidates both older OTPs and verified tokens on accepted resend", async () => {
    await service.requestReset(user.email);
    const old = await latest();
    await allowResend();
    await service.requestReset(user.email);
    expect((await repo().findOneByOrFail({ id: old.id })).status).toBe(
      "invalidated",
    );
    const { resetToken } = await service.verifyOtp(user.email, sentOtp());
    await allowResend();
    await service.requestReset(user.email);
    await expect(service.resetPassword(input(resetToken))).rejects.toThrow(
      "invalid or expired",
    );
  });
  it("enforces the five-per-hour quota including failed SMTP sends", async () => {
    mail.sendResetPasswordOtp.mockRejectedValue(new Error("test SMTP failure"));
    for (let i = 0; i < 5; i++) {
      await service.requestReset(user.email);
      await allowResend();
    }
    await service.requestReset(user.email);
    expect(mail.sendResetPasswordOtp).toHaveBeenCalledTimes(5);
    expect(await repo().countBy({ userId: user.id })).toBe(5);
  });
  it("returns a generic result for missing, locked and deleted accounts", async () => {
    expect(await service.requestReset("missing@example.com")).toEqual({
      requested: true,
    });
    await ds.getRepository(UserEntity).update(user.id, { isLocked: true });
    expect(await service.requestReset(user.email)).toEqual({ requested: true });
    await ds.getRepository(UserEntity).softDelete(user.id);
    expect(await service.requestReset(user.email)).toEqual({ requested: true });
    expect(mail.sendResetPasswordOtp).not.toHaveBeenCalled();
    expect(await repo().count()).toBe(0);
  });
  it("rechecks account eligibility after verification", async () => {
    const { resetToken } = await verified();
    await ds.getRepository(UserEntity).update(user.id, { isLocked: true });
    await expect(service.resetPassword(input(resetToken))).rejects.toThrow(
      "invalid or expired",
    );
    await ds.getRepository(UserEntity).update(user.id, { isLocked: false });
    await ds.getRepository(UserEntity).softDelete(user.id);
    await expect(service.resetPassword(input(resetToken))).rejects.toThrow(
      "invalid or expired",
    );
  });
  it("allows a Google-style account with a randomly generated password to establish a password", async () => {
    await ds
      .getRepository(UserEntity)
      .update(user.id, { password: hashSync(uuidv7(), 10) });
    const { resetToken } = await verified();
    await service.resetPassword(input(resetToken));
    expect(
      await passwords.isValidPassword(
        "new-password-123",
        (await ds.getRepository(UserEntity).findOneByOrFail({ id: user.id }))
          .password,
      ),
    ).toBe(true);
  });
  it("activates no usable OTP when SMTP fails", async () => {
    mail.sendResetPasswordOtp.mockRejectedValueOnce(new Error("SMTP timeout"));
    expect(await service.requestReset(user.email)).toEqual({ requested: true });
    expect((await latest()).status).toBe("failed");
    expect((await latest()).otpHash).toBeNull();
    await expect(service.verifyOtp(user.email, sentOtp())).rejects.toThrow(
      "invalid or expired",
    );
  });
  it("does not activate a superseded challenge when an older SMTP call completes later", async () => {
    let complete!: () => void;
    mail.sendResetPasswordOtp.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    const pendingSend = service.requestReset(user.email);
    // Wait for SMTP, not a wall-clock guess; all DB preparation has committed.
    while (!complete)
      await new Promise<void>((resolve) => setImmediate(resolve));
    const old = await latest();
    expect(old.status).toBe("pending");
    await expect(service.verifyOtp(user.email, sentOtp())).rejects.toThrow(
      "invalid or expired",
    );
    await allowResend();
    await service.requestReset(user.email);
    complete();
    await pendingSend;
    expect((await repo().findOneByOrFail({ id: old.id })).status).toBe(
      "invalidated",
    );
    expect((await latest()).status).toBe("active");
  });
  it("serializes concurrent requests and verification", async () => {
    await Promise.all([
      service.requestReset(user.email),
      service.requestReset(user.email),
    ]);
    expect(mail.sendResetPasswordOtp).toHaveBeenCalledTimes(1);
    const results = await Promise.allSettled([
      service.verifyOtp(user.email, sentOtp()),
      service.verifyOtp(user.email, sentOtp()),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });
  it("allows at most one of two concurrent resets to consume a token", async () => {
    const { resetToken } = await verified();
    const results = await Promise.allSettled([
      service.resetPassword(input(resetToken, "password-one")),
      service.resetPassword(input(resetToken, "password-two")),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(mail.sendPasswordChanged).toHaveBeenCalledTimes(1);
  });
  it("rolls password and consumption back if revocation fails", async () => {
    const { resetToken } = await verified();
    const revoke = jest
      .spyOn(refresh, "revokeAllRefreshTokensForUser")
      .mockRejectedValueOnce(new Error("revocation failed"));
    try {
      await expect(service.resetPassword(input(resetToken))).rejects.toThrow(
        "revocation failed",
      );
      expect((await latest()).status).toBe("verified");
      const unchanged = await ds
        .getRepository(UserEntity)
        .findOneByOrFail({ id: user.id });
      expect(
        await passwords.isValidPassword("old-password-123", unchanged.password),
      ).toBe(true);
      expect(mail.sendPasswordChanged).not.toHaveBeenCalled();
      await expect(service.resetPassword(input(resetToken))).resolves.toEqual({
        changed: true,
      });
    } finally {
      revoke.mockRestore();
    }
  });
  it("does not roll back a password change when the notification email fails", async () => {
    const { resetToken } = await verified();
    mail.sendPasswordChanged.mockRejectedValueOnce(new Error("SMTP failed"));
    expect(await service.resetPassword(input(resetToken))).toEqual({
      changed: true,
    });
    expect((await latest()).status).toBe("consumed");
  });
  it("rejects invalid password confirmation without consuming the token", async () => {
    const { resetToken } = await verified();
    await expect(
      service.resetPassword({
        ...input(resetToken),
        confirmPassword: "wrong-confirmation",
      }),
    ).rejects.toThrow("confirmation");
    await expect(
      service.resetPassword(input(resetToken, "ắ".repeat(25))),
    ).rejects.toThrow("72 UTF-8 bytes");
    expect((await latest()).status).toBe("verified");
  });
  it("cleans old challenges but retains a valid reset token even after OTP expiry", async () => {
    const oldDate = new Date(Date.now() - 25 * 3600000);
    const now = Date.now();
    await repo().save([
      repo().create({
        id: uuidv7(),
        userId: user.id,
        createdAt: oldDate,
        otpExpiresAt: oldDate,
        status: "active",
      }),
      repo().create({
        id: uuidv7(),
        userId: user.id,
        createdAt: oldDate,
        otpExpiresAt: oldDate,
        status: "verified",
        resetTokenHash: hashResetToken(createResetToken()),
        resetTokenExpiresAt: new Date(now + 60000),
      }),
      repo().create({
        id: uuidv7(),
        userId: user.id,
        createdAt: oldDate,
        otpExpiresAt: oldDate,
        status: "consumed",
      }),
      repo().create({
        id: uuidv7(),
        userId: user.id,
        createdAt: new Date(),
        otpExpiresAt: new Date(now - 1),
        status: "failed",
      }),
    ]);
    expect(await service.cleanupExpiredChallenges()).toEqual({ count: 2 });
    expect(await repo().count()).toBe(2);
    expect(await repo().countBy({ status: "verified" })).toBe(1);
  });
});
