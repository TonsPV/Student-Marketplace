import type { MessageEntity } from "./entities/message.entity";
import type { MessageResponseDto } from "./dto/message-response.dto";
import { PREVIEW_MAX_LENGTH } from "./messages.constants";

export type PreparedImageUrls = {
  urls: string[];
  expiresAt: string | null;
};

/**
 * Mapper thuần: chỉ dùng URL đã chuẩn bị, không thực hiện I/O hay ký URL
 * (spec §5.8). Mọi call site (send, replay, history, realtime payload đã
 * materialize) phải truyền đủ prepared argument — không dùng
 * rows.map(toMessageResponse) vì argument thứ hai của callback là index.
 */
export function toMessageResponse(
  message: MessageEntity,
  prepared: PreparedImageUrls,
): MessageResponseDto {
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    sequence: String(message.sequence),
    content: message.content ?? null,
    images: prepared.urls,
    imagesExpireAt: prepared.expiresAt,
    isRead: message.isRead,
    createdAt: message.createdAt,
    clientId: message.clientId ?? null,
  };
}

/** Sắp xếp ảnh theo position trước khi ký URL/gọi mapper. */
export function sortImagesByPosition<T extends { position: number }>(
  images: T[],
): T[] {
  return [...images].sort((a, b) => a.position - b.position);
}

/**
 * Preview tối đa 100 code points; dài hơn thì 99 ký tự + '…'.
 * Dùng Array.from để không cắt nửa surrogate (emoji). Không content →
 * '[Hình ảnh]' / '[N hình ảnh]' với count sau dedup (spec §5.8, U4/U5).
 */
export function buildMessagePreview(
  content: string | null | undefined,
  imageCount: number,
): string {
  const text = (content ?? "").trim();
  if (text.length > 0) {
    const points = Array.from(text);
    if (points.length <= PREVIEW_MAX_LENGTH) return text;
    return `${points.slice(0, PREVIEW_MAX_LENGTH - 1).join("")}…`;
  }
  if (imageCount <= 0) return "";
  if (imageCount === 1) return "[Hình ảnh]";
  return `[${imageCount} hình ảnh]`;
}

/** Loại trùng key giữ thứ tự xuất hiện đầu tiên (spec §3.2, §5.3). */
export function dedupKeys(keys: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const key of keys) {
    if (!seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

/**
 * So sánh idempotency payload: (logical target, content trim/null,
 * ordered dedup keys). postId và conversationId của cùng conversation là
 * cùng target — không so sánh hình thức field. Không so sánh presigned URLs.
 */
export type IdempotencyPayload = {
  conversationId: string;
  content: string | null;
  keys: string[];
};

export function normalizeIdempotencyPayload(
  conversationId: string,
  content: string | null | undefined,
  keys: string[],
): IdempotencyPayload {
  const trimmed = (content ?? "").trim();
  return {
    conversationId,
    content: trimmed.length > 0 ? trimmed : null,
    keys: dedupKeys(keys),
  };
}

export function isSameIdempotencyPayload(
  a: IdempotencyPayload,
  b: IdempotencyPayload,
): boolean {
  if (a.conversationId !== b.conversationId) return false;
  if (a.content !== b.content) return false;
  if (a.keys.length !== b.keys.length) return false;
  return a.keys.every((key, index) => key === b.keys[index]);
}
