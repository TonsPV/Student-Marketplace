/**
 * MODULE: AUTHENTICATION & PHIÊN ĐĂNG NHẬP
 *
 * WORD TEST CASES:
 * - TC-PRC-01: Sinh OTP 6 chữ số ASCII và token ngẫu nhiên 32 byte
 * - TC-PRC-02: OTP được liên kết (bind) với cả challenge và secret
 * - TC-PRC-03: Chấp nhận OTP có số 0 đầu; chỉ trim whitespace ở email
 * - TC-PRC-04: Từ chối: malformed OTP 123456
 * - TC-PRC-05: Từ chối: malformed OTP "12345"
 * - TC-PRC-06: Từ chối: malformed OTP "1234567"
 * - TC-PRC-07: Từ chối: malformed OTP "+12345"
 * - TC-PRC-08: Từ chối: malformed OTP "１２３４５６"
 * - TC-PRC-09: Từ chối: malformed OTP "12345 "
 * - TC-PRC-10: Ràng buộc giới hạn 72 byte của bcrypt, kể cả mật khẩu nhiều byte
 */

import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import {
  createOtp,
  createResetToken,
  hashOtp,
  hashResetToken,
  otpMatches,
} from "../../src/modules/auth/services/password-reset.crypto";
import {
  ResetPasswordDto,
  SendResetPasswordDto,
  VerifyOtpDto,
} from "../../src/modules/auth/dto/reset-password.dto";

describe("password reset secrets and validation", () => {
  const secret = "test-secret-".repeat(4);
  // [WORD-TC: TC-PRC-01]
  // Chức năng: Sinh OTP 6 chữ số ASCII và token ngẫu nhiên 32 byte
  it("[TC-PRC-01] Sinh OTP 6 chữ số ASCII và token ngẫu nhiên 32 byte", () => {
    for (let i = 0; i < 100; i++) expect(createOtp()).toMatch(/^[0-9]{6}$/);
    const token = createResetToken();
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(hashResetToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(createResetToken()).not.toBe(token);
  });
  // [WORD-TC: TC-PRC-02]
  // Chức năng: OTP được liên kết (bind) với cả challenge và secret
  it("[TC-PRC-02] OTP được liên kết (bind) với cả challenge và secret", () => {
    const stored = hashOtp(secret, "challenge-a", "012345");
    expect(stored).not.toContain("012345");
    expect(otpMatches(secret, "challenge-a", "012345", stored)).toBe(true);
    expect(otpMatches(secret, "challenge-b", "012345", stored)).toBe(false);
    expect(
      otpMatches("different-secret", "challenge-a", "012345", stored),
    ).toBe(false);
    expect(otpMatches(secret, "challenge-a", "012346", stored)).toBe(false);
    expect(otpMatches(secret, "challenge-a", "012345", "invalid")).toBe(false);
  });
  // [WORD-TC: TC-PRC-03]
  // Chức năng: Chấp nhận OTP có số 0 đầu; chỉ trim whitespace ở email
  it("[TC-PRC-03] Chấp nhận OTP có số 0 đầu; chỉ trim whitespace ở email", async () => {
    const dto = plainToInstance(VerifyOtpDto, {
      email: " Student@example.com ",
      otp: "012345",
    });
    expect(dto.email).toBe("Student@example.com");
    expect(await validate(dto)).toEqual([]);
    expect(
      await validate(plainToInstance(SendResetPasswordDto, { email: "bad" })),
    ).not.toEqual([]);
  });
  // [WORD-TC: TC-PRC-04]
  // Chức năng: Từ chối: malformed OTP 123456
  // [WORD-TC: TC-PRC-05]
  // Chức năng: Từ chối: malformed OTP "12345"
  // [WORD-TC: TC-PRC-06]
  // Chức năng: Từ chối: malformed OTP "1234567"
  // [WORD-TC: TC-PRC-07]
  // Chức năng: Từ chối: malformed OTP "+12345"
  // [WORD-TC: TC-PRC-08]
  // Chức năng: Từ chối: malformed OTP "１２３４５６"
  // [WORD-TC: TC-PRC-09]
  // Chức năng: Từ chối: malformed OTP "12345 "
  it.each([123456, "12345", "1234567", "+12345", "１２３４５６", "12345 "])(
    "[TC-PRC] Từ chối mã OTP sai định dạng: %p",
    async (otp) => {
      expect(
        await validate(
          plainToInstance(VerifyOtpDto, { email: "a@example.com", otp }),
        ),
      ).not.toEqual([]);
    },
  );
  // [WORD-TC: TC-PRC-10]
  // Chức năng: Ràng buộc giới hạn 72 byte của bcrypt, kể cả mật khẩu nhiều byte
  it("[TC-PRC-10] Ràng buộc giới hạn 72 byte của bcrypt, kể cả mật khẩu nhiều byte", async () => {
    const input = {
      resetToken: createResetToken(),
      newPassword: "a".repeat(72),
      confirmPassword: "a".repeat(72),
    };
    expect(await validate(plainToInstance(ResetPasswordDto, input))).toEqual(
      [],
    );
    for (const password of [
      "a".repeat(73),
      "ắ".repeat(25),
      "short",
      12345678,
    ]) {
      expect(
        await validate(
          plainToInstance(ResetPasswordDto, {
            ...input,
            newPassword: password,
          }),
        ),
      ).not.toEqual([]);
    }
    expect(
      await validate(
        plainToInstance(ResetPasswordDto, {
          ...input,
          resetToken: "not-a-reset-token",
        }),
      ),
    ).not.toEqual([]);
  });
});
