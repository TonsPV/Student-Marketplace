/**
 * MODULE: CONVERSATIONS & MESSAGES
 *
 * WORD TEST CASES:
 * - TC-MMAP-01: trả '[2 hình ảnh]' khi chỉ có 2 ảnh sau dedup
 * - TC-MMAP-02: giữ nguyên content ngắn
 * - TC-MMAP-03: cắt tối đa 100 code points, kết thúc … (150 code points)
 * - TC-MMAP-04: không cắt nửa surrogate với emoji
 * - TC-MMAP-05: loại trùng giữ thứ tự đầu tiên
 * - TC-MMAP-06: mapper thuần: dùng đúng prepared args, giữ sequence string precision
 * - TC-MMAP-07: message không ảnh → images rỗng, expiry null
 * - TC-MMAP-08: sắp xếp theo position trước khi ký URL
 * - TC-MMAP-09: cùng target/payload → giống nhau
 * - TC-MMAP-10: khác order/content/target → khác nhau
 * - TC-MMAP-11: content rỗng normalize thành null
 */

import "reflect-metadata";
import {
  buildMessagePreview,
  dedupKeys,
  isSameIdempotencyPayload,
  normalizeIdempotencyPayload,
  sortImagesByPosition,
  toMessageResponse,
} from "src/modules/messages/messages.mapper";
import type { MessageEntity } from "src/modules/messages/entities/message.entity";

const CONV = "11111111-1111-4111-8111-111111111111";

function core(overrides: Partial<MessageEntity> = {}): MessageEntity {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    conversationId: CONV,
    senderId: "33333333-3333-4333-8333-333333333333",
    sequence: "9007199254740993",
    content: "hello",
    clientId: "client-1",
    images: [],
    isRead: false,
    createdAt: new Date("2026-10-06T00:00:00.000Z"),
    ...overrides,
  } as MessageEntity;
}

describe("buildMessagePreview (U4/U5)", () => {
  // [WORD-TC: TC-MMAP-01]
  // Chức năng: trả '[2 hình ảnh]' khi chỉ có 2 ảnh sau dedup
  it("[TC-MMAP-01] trả '[2 hình ảnh]' khi chỉ có 2 ảnh sau dedup", () => {
    expect(buildMessagePreview(null, 2)).toBe("[2 hình ảnh]");
    expect(buildMessagePreview("   ", 1)).toBe("[Hình ảnh]");
  });

  // [WORD-TC: TC-MMAP-02]
  // Chức năng: giữ nguyên content ngắn
  it("[TC-MMAP-02] giữ nguyên content ngắn", () => {
    expect(buildMessagePreview("Còn hàng không?", 0)).toBe("Còn hàng không?");
  });

  // [WORD-TC: TC-MMAP-03]
  // Chức năng: cắt tối đa 100 code points, kết thúc … (150 code points)
  it("[TC-MMAP-03] cắt tối đa 100 code points, kết thúc … (150 code points)", () => {
    const text = "a".repeat(150);
    const preview = buildMessagePreview(text, 0);
    expect(Array.from(preview).length).toBeLessThanOrEqual(100);
    expect(preview.endsWith("…")).toBe(true);
  });

  // [WORD-TC: TC-MMAP-04]
  // Chức năng: không cắt nửa surrogate với emoji
  it("[TC-MMAP-04] không cắt nửa surrogate với emoji", () => {
    const text = "😀".repeat(150);
    const preview = buildMessagePreview(text, 0);
    expect(Array.from(preview).length).toBeLessThanOrEqual(100);
    // Không có lone surrogate
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(preview)).toBe(false);
    expect(/<![\uDC00-\uDFFF]/.test(`X${preview}`)).toBe(false);
  });
});

describe("dedupKeys (U4)", () => {
  // [WORD-TC: TC-MMAP-05]
  // Chức năng: loại trùng giữ thứ tự đầu tiên
  it("[TC-MMAP-05] loại trùng giữ thứ tự đầu tiên", () => {
    expect(dedupKeys(["b", "a", "b", "c", "a"])).toEqual(["b", "a", "c"]);
  });
});

describe("toMessageResponse (U13)", () => {
  // [WORD-TC: TC-MMAP-06]
  // Chức năng: mapper thuần: dùng đúng prepared args, giữ sequence string precision
  it("[TC-MMAP-06] mapper thuần: dùng đúng prepared args, giữ sequence string precision", () => {
    const dto = toMessageResponse(core(), {
      urls: ["https://signed/1", "https://signed/2"],
      expiresAt: "2026-10-06T01:00:00.000Z",
    });
    expect(dto.sequence).toBe("9007199254740993");
    expect(dto.images).toEqual(["https://signed/1", "https://signed/2"]);
    expect(dto.imagesExpireAt).toBe("2026-10-06T01:00:00.000Z");
    expect(dto.clientId).toBe("client-1");
  });

  // [WORD-TC: TC-MMAP-07]
  // Chức năng: message không ảnh → images rỗng, expiry null
  it("[TC-MMAP-07] message không ảnh → images rỗng, expiry null", () => {
    const dto = toMessageResponse(core(), { urls: [], expiresAt: null });
    expect(dto.images).toEqual([]);
    expect(dto.imagesExpireAt).toBeNull();
  });
});

describe("sortImagesByPosition", () => {
  // [WORD-TC: TC-MMAP-08]
  // Chức năng: sắp xếp theo position trước khi ký URL
  it("[TC-MMAP-08] sắp xếp theo position trước khi ký URL", () => {
    const sorted = sortImagesByPosition([
      { position: 2, key: "c" },
      { position: 0, key: "a" },
      { position: 1, key: "b" },
    ]);
    expect(sorted.map((i) => i.key)).toEqual(["a", "b", "c"]);
  });
});

describe("idempotency payload (U14)", () => {
  // [WORD-TC: TC-MMAP-09]
  // Chức năng: cùng target/payload → giống nhau
  it("[TC-MMAP-09] cùng target/payload → giống nhau", () => {
    const a = normalizeIdempotencyPayload(CONV, "  hello  ", [
      "k1",
      "k1",
      "k2",
    ]);
    const b = normalizeIdempotencyPayload(CONV, "hello", ["k1", "k2"]);
    expect(a.content).toBe("hello");
    expect(a.keys).toEqual(["k1", "k2"]);
    expect(isSameIdempotencyPayload(a, b)).toBe(true);
  });

  // [WORD-TC: TC-MMAP-10]
  // Chức năng: khác order/content/target → khác nhau
  it("[TC-MMAP-10] khác order/content/target → khác nhau", () => {
    const base = normalizeIdempotencyPayload(CONV, "hello", ["k1", "k2"]);
    expect(
      isSameIdempotencyPayload(
        base,
        normalizeIdempotencyPayload(CONV, "hello", ["k2", "k1"]),
      ),
    ).toBe(false);
    expect(
      isSameIdempotencyPayload(
        base,
        normalizeIdempotencyPayload(CONV, "other", ["k1", "k2"]),
      ),
    ).toBe(false);
    expect(
      isSameIdempotencyPayload(
        base,
        normalizeIdempotencyPayload(
          "99999999-9999-4999-8999-999999999999",
          "hello",
          ["k1", "k2"],
        ),
      ),
    ).toBe(false);
  });

  // [WORD-TC: TC-MMAP-11]
  // Chức năng: content rỗng normalize thành null
  it("[TC-MMAP-11] content rỗng normalize thành null", () => {
    expect(normalizeIdempotencyPayload(CONV, "   ", []).content).toBeNull();
    expect(normalizeIdempotencyPayload(CONV, undefined, []).content).toBeNull();
  });
});
