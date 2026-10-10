/** Quy ước key ảnh chat private (spec §10.2–10.3). */
export const MESSAGE_IMAGE_KEY_PREFIX = "messages/";

export const MESSAGE_IMAGE_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type MessageImageContentType =
  (typeof MESSAGE_IMAGE_CONTENT_TYPES)[number];

export const CONTENT_TYPE_TO_EXTENSION: Record<
  MessageImageContentType,
  "jpg" | "png" | "webp"
> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * messages/<user uuid>/<object uuid>.(jpg|png|webp).
 * UUID canonical (hex + 4 dấu gạch), khớp IsUUID/all validation —
 * không chỉ đếm ký tự hex. Neo toàn chuỗi nên chặn ../,
 * encoded separator và external URL.
 */
export const MESSAGE_IMAGE_KEY_REGEX =
  /^messages\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

/** Public post images remain in the private bucket; readers receive signed GET URLs. */
export const POST_IMAGE_KEY_REGEX =
  /^posts\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

export const SUPPORTED_UPLOAD_PURPOSES = ["message", "post"] as const;
export type UploadPurpose = (typeof SUPPORTED_UPLOAD_PURPOSES)[number];
