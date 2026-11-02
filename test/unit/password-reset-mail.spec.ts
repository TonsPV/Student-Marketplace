/**
 * MODULE: AUTHENTICATION & PHIÊN ĐĂNG NHẬP
 *
 * WORD TEST CASES:
 * - TC-PRM-01: Render email HTML+text đầy đủ qua @nestjs-modules/mailer và Nodemailer, không cần mạng
 * - TC-PRM-02: Validate cấu hình mail và luôn bật TLS trên cổng 465/587
 * - TC-PRM-03: HTML render nghiêm ngặt, escape tên người dùng, giữ số 0 đầu của OTP
 * - TC-PRM-04: Gửi cả HTML lẫn text; từ chối khi người nhận không chấp nhận mail
 * - TC-PRM-05: Gửi email thông báo đổi mật khẩu không kèm thông tin đăng nhập
 */

import { ConfigService } from "@nestjs/config";
import { MailerModule, MailerService } from "@nestjs-modules/mailer";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Handlebars from "handlebars";
import { mailOptions } from "../../src/config/mail.config";
import { MailService } from "../../src/modules/mailer/mail.service";

const configuration = {
  EMAIL_HOST: "smtp.example.com",
  EMAIL_USER: "sender@example.com",
  EMAIL_PASSWORD: "test-only-password",
  MAIL_FROM: "Student Marketplace <sender@example.com>",
};

describe("password reset SMTP and templates", () => {
  // [WORD-TC: TC-PRM-01]
  // Chức năng: Render email HTML+text đầy đủ qua @nestjs-modules/mailer và Nodemailer, không cần mạng
  it("[TC-PRM-01] Render email HTML+text đầy đủ qua @nestjs-modules/mailer và Nodemailer, không cần mạng", async () => {
    @Module({
      imports: [
        MailerModule.forRoot({
          ...mailOptions(new ConfigService(configuration)),
          transport: { streamTransport: true, buffer: true, newline: "unix" },
        }),
      ],
    })
    class TestMailModule {}
    const app = await NestFactory.createApplicationContext(TestMailModule, {
      logger: false,
      abortOnError: false,
    });
    try {
      const result = await app.get(MailerService).sendMail({
        to: "student@example.com",
        subject: "Test reset",
        template: "reset-password",
        text: "Test OTP: 012345",
        context: {
          fullName: "<script>bad</script>",
          otp: "012345",
          expiresInMinutes: 10,
        },
      });
      const message = result.message.toString("utf8");
      expect(message).toContain("multipart/alternative");
      expect(message).toContain("text/plain");
      expect(message).toContain("text/html");
      expect(message).toContain("012345");
      expect(message).toContain("&lt;script&gt;");
      expect(message).not.toContain("<script>bad</script>");
    } finally {
      await app.close();
    }
  });
  // [WORD-TC: TC-PRM-02]
  // Chức năng: Validate cấu hình mail và luôn bật TLS trên cổng 465/587
  it("[TC-PRM-02] Validate cấu hình mail và luôn bật TLS trên cổng 465/587", () => {
    expect(
      mailOptions(new ConfigService(configuration)).transport,
    ).toMatchObject({
      port: 465,
      secure: true,
      tls: { rejectUnauthorized: true },
    });
    expect(
      mailOptions(
        new ConfigService({
          ...configuration,
          EMAIL_PORT: "587",
          EMAIL_SECURE: "false",
        }),
      ).transport,
    ).toMatchObject({ port: 587, secure: false, requireTLS: true });
    for (const options of [
      { EMAIL_USER: "" },
      { MAIL_FROM: "" },
      { EMAIL_PORT: "abc" },
      { EMAIL_PORT: "0" },
      { EMAIL_SECURE: "yes" },
      { EMAIL_PORT: "587", EMAIL_SECURE: "true" },
      { EMAIL_PORT: "465", EMAIL_SECURE: "false" },
    ])
      expect(() =>
        mailOptions(new ConfigService({ ...configuration, ...options })),
      ).toThrow();
  });
  // [WORD-TC: TC-PRM-03]
  // Chức năng: HTML render nghiêm ngặt, escape tên người dùng, giữ số 0 đầu của OTP
  it("[TC-PRM-03] HTML render nghiêm ngặt, escape tên người dùng, giữ số 0 đầu của OTP", () => {
    const template = readFileSync(
      join(__dirname, "../../src/modules/mailer/templates/reset-password.hbs"),
      "utf8",
    );
    const render = Handlebars.compile(template, { strict: true });
    const html = render({
      fullName: "<script>alert(1)</script>",
      otp: "012345",
      expiresInMinutes: 10,
    });
    expect(html).toContain("012345");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(() => render({ fullName: "Student", otp: "012345" })).toThrow();
  });
  // [WORD-TC: TC-PRM-04]
  // Chức năng: Gửi cả HTML lẫn text; từ chối khi người nhận không chấp nhận mail
  it("[TC-PRM-04] Gửi cả HTML lẫn text; từ chối khi người nhận không chấp nhận mail", async () => {
    const sendMail = jest
      .fn()
      .mockResolvedValue({ accepted: ["student@example.com"] });
    const service = new MailService({ sendMail } as unknown as MailerService);
    const input = {
      email: "student@example.com",
      fullName: "Student",
      otp: "012345",
    };
    await service.sendResetPasswordOtp(input);
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: input.email,
        template: "reset-password",
        text: expect.stringContaining("012345"),
        context: { fullName: "Student", otp: "012345", expiresInMinutes: 10 },
      }),
    );
    sendMail.mockResolvedValueOnce({ accepted: [], rejected: [input.email] });
    await expect(service.sendResetPasswordOtp(input)).rejects.toThrow(
      "SMTP did not accept",
    );
    sendMail.mockRejectedValueOnce(new Error("SMTP failed"));
    await expect(service.sendResetPasswordOtp(input)).rejects.toThrow(
      "SMTP failed",
    );
  });
  // [WORD-TC: TC-PRM-05]
  // Chức năng: Gửi email thông báo đổi mật khẩu không kèm thông tin đăng nhập
  it("[TC-PRM-05] Gửi email thông báo đổi mật khẩu không kèm thông tin đăng nhập", async () => {
    const sendMail = jest
      .fn()
      .mockResolvedValue({ accepted: ["student@example.com"] });
    await new MailService({
      sendMail,
    } as unknown as MailerService).sendPasswordChanged({
      email: "student@example.com",
      fullName: "Student",
    });
    const message = sendMail.mock.calls[0][0];
    expect(message.template).toBe("password-changed");
    expect(message.context).toEqual({ fullName: "Student" });
    expect(message).not.toHaveProperty("password");
  });
});
