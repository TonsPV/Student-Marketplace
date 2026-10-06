import { registerAs } from "@nestjs/config";

export const R2_CONFIG_KEY = "r2";
export const UPLOAD_CONFIG_KEY = "upload";

export type R2Config = {
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  endpointUrl: string;
};

export type UploadConfig = {
  maxFileSizeBytes: number;
  putSignedUrlExpiresSec: number;
  getSignedUrlExpiresSec: number;
};

const TTL_MIN = 1;
const TTL_MAX = 604800; // 7 days, S3 presigned URL limit

function requireNonEmpty(value: string | undefined, key: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing env variable: ${key}`);
  }
  return value.trim();
}

function parsePositiveInt(
  raw: string | undefined,
  key: string,
  fallback: number,
): number {
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < TTL_MIN || parsed > TTL_MAX) {
    throw new Error(
      `Invalid env variable: ${key} must be an integer in [${TTL_MIN}, ${TTL_MAX}]`,
    );
  }
  return parsed;
}

function parseMaxUploadSizeBytes(raw: string | undefined): number {
  const fallbackMb = 5;
  const mb = raw === undefined || raw === "" ? fallbackMb : Number(raw);
  if (!Number.isFinite(mb) || mb <= 0) {
    throw new Error(
      "Invalid env variable: MAX_UPLOAD_SIZE_MB must be a positive finite number",
    );
  }
  const bytes = Math.floor(mb * 1024 * 1024);
  if (bytes <= 0 || !Number.isSafeInteger(bytes)) {
    throw new Error(
      "Invalid env variable: MAX_UPLOAD_SIZE_MB converts to an out-of-range byte size",
    );
  }
  return bytes;
}

// Lưu ý: không đọc R2_PUBLIC_URL ở đường ảnh message (spec §10.1).
// Biến đó (nếu còn) chỉ phục vụ consumer khác, không phải chat private.
export const r2Config = registerAs(R2_CONFIG_KEY, (): R2Config => {
  const endpointUrl = requireNonEmpty(
    process.env.R2_ENDPOINT_URL,
    "R2_ENDPOINT_URL",
  );
  let parsed: URL;
  try {
    parsed = new URL(endpointUrl);
  } catch {
    throw new Error(
      "Invalid env variable: R2_ENDPOINT_URL must be a valid URL",
    );
  }
  if (parsed.protocol !== "https:") {
    throw new Error(
      "Invalid env variable: R2_ENDPOINT_URL must be an HTTPS S3 endpoint " +
        "(https://<accountId>.r2.cloudflarestorage.com), not a public custom domain",
    );
  }
  if (!parsed.hostname.endsWith(".r2.cloudflarestorage.com")) {
    throw new Error(
      "Invalid env variable: R2_ENDPOINT_URL must be the account S3 endpoint " +
        "(https://<accountId>.r2.cloudflarestorage.com), not a public custom domain",
    );
  }
  return {
    accessKeyId: requireNonEmpty(
      process.env.R2_ACCESS_KEY_ID,
      "R2_ACCESS_KEY_ID",
    ),
    secretAccessKey: requireNonEmpty(
      process.env.R2_SECRET_ACCESS_KEY,
      "R2_SECRET_ACCESS_KEY",
    ),
    bucketName: requireNonEmpty(process.env.R2_BUCKET_NAME, "R2_BUCKET_NAME"),
    endpointUrl,
  };
});

export const uploadConfig = registerAs(UPLOAD_CONFIG_KEY, (): UploadConfig => ({
  maxFileSizeBytes: parseMaxUploadSizeBytes(process.env.MAX_UPLOAD_SIZE_MB),
  putSignedUrlExpiresSec: parsePositiveInt(
    process.env.SIGNED_URL_EXPIRES_SEC,
    "SIGNED_URL_EXPIRES_SEC",
    300,
  ),
  getSignedUrlExpiresSec: parsePositiveInt(
    process.env.SIGNED_GET_URL_EXPIRES_SEC,
    "SIGNED_GET_URL_EXPIRES_SEC",
    900,
  ),
}));
