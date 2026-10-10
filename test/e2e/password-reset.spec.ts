import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { SchedulerRegistry } from "@nestjs/schedule";
import { DataSource } from "typeorm";
import { hashSync } from "bcryptjs";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { configureApplication } from "../../src/main";
import { MailService } from "../../src/modules/mailer/mail.service";
import { ResetPasswordMail } from "../../src/modules/mailer/types/mail.type";
import { PasswordResetService } from "../../src/modules/auth/services/password-reset.service";
import { UserEntity } from "../../src/modules/user/user.entity";
import {
  createTestDataSource,
  initializeTestDatabase,
  disposeTestDatabase,
  ownedTestSchema,
  testDatabaseEnv,
} from "../integration/database";
import { createTestUser } from "../integration/fixtures";

describe("password reset through the full application", () => {
  let app: INestApplication, ds: DataSource;
  let capture: jest.SpyInstance, notice: jest.SpyInstance;
  beforeAll(async () => {
    Object.assign(process.env, testDatabaseEnv(), {
      JWT_ACCESS_SECRET: "test-access-secret-not-for-production",
      JWT_ACCESS_EXPIRED: "15m",
      JWT_REFRESH_SECRET: "test-refresh-secret-not-for-production",
      JWT_REFRESH_EXPIRED: "7d",
      GOOGLE_CLIENT_ID: "test-google-client",
      GOOGLE_CLIENT_SECRET: "test-google-secret",
      GOOGLE_REDIRECT_URI: "http://localhost/api/v1/auth/google/callback",
      FE_DOMAIN: "http://localhost:3000",
      R2_ACCESS_KEY_ID: "test-key",
      R2_SECRET_ACCESS_KEY: "test-secret",
      R2_BUCKET_NAME: "test-bucket",
      R2_ENDPOINT_URL: "https://test-account.r2.cloudflarestorage.com",
      SEED_ADMIN_EMAIL: "reset-test-admin@example.com",
      SEED_ADMIN_NAME: "Test Admin",
      SEED_ADMIN_PASSWORD: "test-admin-password",
      SEED_ADMIN_PHONE: "1234567890",
    });
    ds = createTestDataSource();
    await initializeTestDatabase(ds);
    process.env.POSTGRES_SCHEMA = ownedTestSchema(ds);
    app = await NestFactory.create(AppModule, {
      logger: false,
      abortOnError: false,
    });
    const mail = app.get(MailService);
    // No external service receives mail, including SMTP calls from errors/notices.
    capture = jest
      .spyOn(mail, "sendResetPasswordOtp")
      .mockResolvedValue(undefined);
    notice = jest
      .spyOn(mail, "sendPasswordChanged")
      .mockResolvedValue(undefined);
    configureApplication(app);
    await app.init();
  });
  afterAll(async () => {
    capture?.mockRestore();
    notice?.mockRestore();
    if (app) await app.close();
    if (ds) await disposeTestDatabase(ds);
  });
  const post = (path: string, body: object) =>
    request(app.getHttpServer()).post(`/api/v1/auth/${path}`).send(body);

  it("boots the real AuthModule and registers password-reset cleanup", () => {
    expect(app.get(PasswordResetService)).toBeDefined();
    expect(
      app.get(SchedulerRegistry).getCronJob("password-reset-cleanup"),
    ).toBeDefined();
  });
  it("resets an account, rejects the old password/refresh token, and accepts a new login", async () => {
    const user = await createTestUser(ds, {
      password: hashSync("old-password-123", 10),
    });
    const login = await post("login", {
      email: user.email,
      password: "old-password-123",
    }).expect(201);
    const oldCookie = login.headers["set-cookie"];
    expect(oldCookie).toBeDefined();
    const requested = await post("forgot-password", {
      email: user.email,
    }).expect(200);
    expect(requested.body.data).toEqual({ requested: true });
    const sent = capture.mock.calls.at(-1)![0] as ResetPasswordMail;
    const verified = await post("verify-reset-otp", {
      email: user.email,
      otp: sent.otp,
    }).expect(200);
    const resetToken = verified.body.data.resetToken;
    const reset = await post("reset-password", {
      resetToken,
      newPassword: "new-password-123",
      confirmPassword: "new-password-123",
    }).expect(200);
    expect(reset.body.data).toEqual({ changed: true });
    expect(reset.headers["set-cookie"]).toBeUndefined();
    await post("login", {
      email: user.email,
      password: "old-password-123",
    }).expect(401);
    await request(app.getHttpServer())
      .post("/api/v1/auth/refresh")
      .set("Origin", "http://localhost:3000")
      .set("Cookie", oldCookie)
      .expect(400);
    const updated = await post("login", {
      email: user.email,
      password: "new-password-123",
    }).expect(201);
    expect(updated.body.data.accessToken).toEqual(expect.any(String));
    await post("reset-password", {
      resetToken,
      newPassword: "other-password",
      confirmPassword: "other-password",
    }).expect(400);
    expect(notice).toHaveBeenCalledWith({
      email: user.email,
      fullName: user.fullName,
    });
  });
  it("uses the same response for unknown, locked, deleted and SMTP-failed accounts", async () => {
    const unknown = await post("forgot-password", {
      email: "unknown@example.com",
    }).expect(200);
    const locked = await createTestUser(ds, { isLocked: true });
    const deleted = await createTestUser(ds);
    await ds.getRepository(UserEntity).softDelete(deleted.id);
    const failed = await createTestUser(ds);
    capture.mockRejectedValueOnce(new Error("SMTP unavailable"));
    const responses = [
      await post("forgot-password", { email: locked.email }).expect(200),
      await post("forgot-password", { email: deleted.email }).expect(200),
      await post("forgot-password", { email: failed.email }).expect(200),
    ];
    for (const response of responses)
      expect(response.body).toEqual(unknown.body);
  });
});
