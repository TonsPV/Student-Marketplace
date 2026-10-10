import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";

export function createOtp(): string {
  return randomInt(0, 1000000).toString().padStart(6, "0");
}

export function hashOtp(
  secret: string,
  challengeId: string,
  otp: string,
): string {
  return createHmac("sha256", secret)
    .update(`${challengeId}:${otp}`)
    .digest("hex");
}

export function otpMatches(
  secret: string,
  challengeId: string,
  otp: string,
  stored: string,
): boolean {
  if (!/^[0-9a-f]{64}$/.test(stored)) return false;
  return timingSafeEqual(
    Buffer.from(hashOtp(secret, challengeId, otp), "hex"),
    Buffer.from(stored, "hex"),
  );
}

export function createResetToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
