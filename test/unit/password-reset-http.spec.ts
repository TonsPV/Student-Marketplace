/**
 * MODULE: AUTHENTICATION & PHIÊN ĐĂNG NHẬP
 *
 * WORD TEST CASES:
 * - TC-PRH-01: 3 route public hoạt động không cần bearer token, dùng response envelope chuẩn của hệ thống
 * - TC-PRH-02: Response của forgot-password giống nhau bất kể điều kiện tồn tại email (tránh lộ thông tin)
 * - TC-PRH-03: Từ chối dữ liệu sai định dạng và contract cũ (email/otp một bước)
 * - TC-PRH-04: Lỗi mã không hợp lệ trả về thống nhất với lỗi do service phát sinh
 * - TC-PRH-05: Giới hạn (rate limit): forgot-password by IP
 * - TC-PRH-06: Giới hạn (rate limit): verify-reset-otp by IP
 * - TC-PRH-07: Giới hạn (rate limit): reset-password by IP
 */

import "reflect-metadata";
import {
  BadRequestException,
  INestApplication,
  Module,
  ValidationPipe,
  VersioningType,
} from "@nestjs/common";
import { NestFactory, Reflector } from "@nestjs/core";
import { ThrottlerModule } from "@nestjs/throttler";
import request from "supertest";
import { PasswordResetController } from "../../src/modules/auth/password-reset.controller";
import { PasswordResetService } from "../../src/modules/auth/services/password-reset.service";
import { JwtAuthGuard } from "../../src/common/guards/jwt-auth.guard";
import { PoliciesGuard } from "../../src/modules/authorization/guards/policies.guard";
import { AuthorizationService } from "../../src/modules/authorization/authorization.service";
import { TransformInterceptor } from "../../src/common/interceptors/transform.interceptor";

describe("public password reset HTTP contract", () => {
  let app: INestApplication;
  const service = {
    requestReset: jest.fn(),
    verifyOtp: jest.fn(),
    resetPassword: jest.fn(),
  };
  beforeEach(async () => {
    service.requestReset.mockReset().mockResolvedValue({ requested: true });
    service.verifyOtp.mockReset().mockResolvedValue({
      resetToken: "a".repeat(43),
      expiresAt: "2026-10-10T12:05:00.000Z",
    });
    service.resetPassword.mockReset().mockResolvedValue({ changed: true });
    @Module({
      imports: [ThrottlerModule.forRoot([{ ttl: 60000, limit: 10 }])],
      controllers: [PasswordResetController],
      providers: [{ provide: PasswordResetService, useValue: service }],
    })
    class TestModule {}
    app = await NestFactory.create(TestModule, {
      logger: false,
      abortOnError: false,
    });
    const reflector = app.get(Reflector);
    app.useGlobalGuards(
      new JwtAuthGuard(reflector),
      new PoliciesGuard(reflector, {
        createGuestContext: () => ({ principal: null }),
      } as unknown as AuthorizationService),
    );
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalInterceptors(new TransformInterceptor(reflector));
    app.setGlobalPrefix("api");
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
    await app.init();
  });
  afterEach(async () => {
    if (app) await app.close();
  });
  const post = (route: string, input: unknown) =>
    request(app.getHttpServer())
      .post(`/api/v1/auth/${route}`)
      .send(input as object);

  // [WORD-TC: TC-PRH-01]
  // Chức năng: 3 route public hoạt động không cần bearer token, dùng response envelope chuẩn của hệ thống
  it("[TC-PRH-01] 3 route public hoạt động không cần bearer token, dùng response envelope chuẩn của hệ thống", async () => {
    const requested = await post("forgot-password", {
      email: " student@example.com ",
    }).expect(200);
    expect(requested.body).toEqual({
      statusCode: 200,
      message: expect.any(String),
      data: { requested: true },
    });
    expect(service.requestReset).toHaveBeenCalledWith("student@example.com");
    const verified = await post("verify-reset-otp", {
      email: "student@example.com",
      otp: "012345",
    }).expect(200);
    expect(verified.body.data).toHaveProperty("resetToken");
    expect(service.verifyOtp).toHaveBeenCalledWith(
      "student@example.com",
      "012345",
    );
    const reset = await post("reset-password", {
      resetToken: "a".repeat(43),
      newPassword: "new-password",
      confirmPassword: "new-password",
    }).expect(200);
    expect(reset.body.data).toEqual({ changed: true });
    expect(reset.headers["set-cookie"]).toBeUndefined();
  });
  // [WORD-TC: TC-PRH-02]
  // Chức năng: Response của forgot-password giống nhau bất kể điều kiện tồn tại email (tránh lộ thông tin)
  it("[TC-PRH-02] Response của forgot-password giống nhau bất kể điều kiện tồn tại email (tránh lộ thông tin)", async () => {
    const a = await post("forgot-password", { email: "active@example.com" });
    const b = await post("forgot-password", { email: "missing@example.com" });
    expect(a.body).toEqual(b.body);
  });
  // [WORD-TC: TC-PRH-03]
  // Chức năng: Từ chối dữ liệu sai định dạng và contract cũ (email/otp một bước)
  it("[TC-PRH-03] Từ chối dữ liệu sai định dạng và contract cũ (email/otp một bước)", async () => {
    await post("forgot-password", { email: "invalid" }).expect(400);
    await post("verify-reset-otp", {
      email: "student@example.com",
      otp: 123456,
    }).expect(400);
    await post("reset-password", {
      email: "student@example.com",
      otp: "012345",
      newPassword: "new-password",
    }).expect(400);
    await post("reset-password", {
      resetToken: "a".repeat(43),
      newPassword: "ắ".repeat(25),
      confirmPassword: "ắ".repeat(25),
    }).expect(400);
    expect(service.resetPassword).not.toHaveBeenCalled();
  });
  // [WORD-TC: TC-PRH-04]
  // Chức năng: Lỗi mã không hợp lệ trả về thống nhất với lỗi do service phát sinh
  it("[TC-PRH-04] Lỗi mã không hợp lệ trả về thống nhất với lỗi do service phát sinh", async () => {
    service.verifyOtp.mockRejectedValue(
      new BadRequestException("Reset code is invalid or expired"),
    );
    const result = await post("verify-reset-otp", {
      email: "student@example.com",
      otp: "012345",
    }).expect(400);
    expect(result.body.message).toBe("Reset code is invalid or expired");
  });
  // [WORD-TC: TC-PRH-05]
  // Chức năng: Giới hạn (rate limit): forgot-password by IP
  // [WORD-TC: TC-PRH-06]
  // Chức năng: Giới hạn (rate limit): verify-reset-otp by IP
  // [WORD-TC: TC-PRH-07]
  // Chức năng: Giới hạn (rate limit): reset-password by IP
  it.each([
    ["forgot-password", 10, { email: "student@example.com" }],
    ["verify-reset-otp", 30, { email: "student@example.com", otp: "012345" }],
    [
      "reset-password",
      10,
      {
        resetToken: "a".repeat(43),
        newPassword: "new-password",
        confirmPassword: "new-password",
      },
    ],
  ])("[TC-PRH] Giới hạn tần suất gọi API (Rate Limit) theo IP cho route %s", async (route, limit, input) => {
    for (let i = 0; i < limit; i++) await post(route, input).expect(200);
    await post(route, input).expect(429);
  });
});
