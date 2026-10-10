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
  it("generates six ASCII digits and 32-byte opaque tokens", () => {
    for (let i = 0; i < 100; i++) expect(createOtp()).toMatch(/^[0-9]{6}$/);
    const token = createResetToken();
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(hashResetToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(createResetToken()).not.toBe(token);
  });
  it("binds OTPs to both the challenge and the secret", () => {
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
  it("accepts leading zeroes and trims only email whitespace", async () => {
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
  it.each([123456, "12345", "1234567", "+12345", "１２３４５６", "12345 "])(
    "rejects malformed OTP %p",
    async (otp) => {
      expect(
        await validate(
          plainToInstance(VerifyOtpDto, { email: "a@example.com", otp }),
        ),
      ).not.toEqual([]);
    },
  );
  it("enforces bcrypt's byte limit, including multibyte passwords", async () => {
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
