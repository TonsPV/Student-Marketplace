/**
 * MODULE: CONVERSATIONS & MESSAGES
 *
 * WORD TEST CASES:
 * - TC-MVAL-01: thiếu cả hai → 400
 * - TC-MVAL-02: cả hai → 400
 * - TC-MVAL-03: null / rỗng / sai UUID → 400
 * - TC-MVAL-04: đúng một UUID hợp lệ + clientId → pass
 * - TC-MVAL-05: E1 thiếu clientId → 400; clientId rỗng sau trim → 400
 * - TC-MVAL-06: quá 2000 ký tự sau trim → 400
 * - TC-MVAL-07: null / sai kiểu → 400; whitespace được chuẩn hóa ở service
 * - TC-MVAL-08: quá 5 ảnh trước dedup → 400
 * - TC-MVAL-09: body content-only đi qua DTO riêng
 * - TC-MVAL-10: body gửi postId/conversationId → 400 (forbidNonWhitelisted)
 * - TC-MVAL-11: alias clientId optional; null không hợp lệ
 * - TC-MVAL-12: Chấp nhận: decimal bigint deltas without converting to a JS number
 * - TC-MVAL-13: limit ngoài 1–100 → 400; before sai UUID/null → 400
 * - TC-MVAL-14: throughMessageId bắt buộc và UUID
 */

import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import {
  GetMessagesQueryDto,
  MarkReadDto,
  SendConversationMessageDto,
  SendMessageDto,
} from "src/modules/messages/dto/send-message.dto";

const POST_ID = "11111111-1111-4111-8111-111111111111";
const CONV_ID = "22222222-2222-4222-8222-222222222222";

function toSendMessage(raw: Record<string, unknown>): SendMessageDto {
  return plainToInstance(SendMessageDto, raw);
}

describe("SendMessageDto XOR target (U1)", () => {
  // [WORD-TC: TC-MVAL-01]
  // Chức năng: thiếu cả hai → 400
  it("[TC-MVAL-01] thiếu cả hai → 400", async () => {
    const errors = await validate(
      toSendMessage({ content: "hi", clientId: "c1" }),
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  // [WORD-TC: TC-MVAL-02]
  // Chức năng: cả hai → 400
  it("[TC-MVAL-02] cả hai → 400", async () => {
    const errors = await validate(
      toSendMessage({
        postId: POST_ID,
        conversationId: CONV_ID,
        content: "hi",
        clientId: "c1",
      }),
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  // [WORD-TC: TC-MVAL-03]
  // Chức năng: null / rỗng / sai UUID → 400
  it("[TC-MVAL-03] null / rỗng / sai UUID → 400", async () => {
    for (const raw of [
      { postId: null, content: "hi", clientId: "c1" },
      { postId: "", content: "hi", clientId: "c1" },
      { postId: "not-a-uuid", content: "hi", clientId: "c1" },
      { conversationId: null, content: "hi", clientId: "c1" },
      { conversationId: "zzz", content: "hi", clientId: "c1" },
    ]) {
      const errors = await validate(toSendMessage(raw));
      expect(errors.length).toBeGreaterThan(0);
    }
  });

  // [WORD-TC: TC-MVAL-04]
  // Chức năng: đúng một UUID hợp lệ + clientId → pass
  it("[TC-MVAL-04] đúng một UUID hợp lệ + clientId → pass", async () => {
    for (const raw of [
      { postId: POST_ID, content: "hi", clientId: "c1" },
      { conversationId: CONV_ID, images: ["k"], clientId: "c1" },
    ]) {
      const errors = await validate(toSendMessage(raw));
      expect(errors).toEqual([]);
    }
  });

  // [WORD-TC: TC-MVAL-05]
  // Chức năng: E1 thiếu clientId → 400; clientId rỗng sau trim → 400
  it("[TC-MVAL-05] E1 thiếu clientId → 400; clientId rỗng sau trim → 400", async () => {
    for (const raw of [
      { postId: POST_ID, content: "hi" },
      { postId: POST_ID, content: "hi", clientId: "   " },
      { postId: POST_ID, content: "hi", clientId: null },
    ]) {
      const errors = await validate(toSendMessage(raw));
      expect(errors.length).toBeGreaterThan(0);
    }
  });
});

describe("SendMessageDto content/images (U2)", () => {
  // [WORD-TC: TC-MVAL-06]
  // Chức năng: quá 2000 ký tự sau trim → 400
  it("[TC-MVAL-06] quá 2000 ký tự sau trim → 400", async () => {
    const errors = await validate(
      toSendMessage({
        postId: POST_ID,
        content: ` ${"a".repeat(2001)} `,
        clientId: "c1",
      }),
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  // [WORD-TC: TC-MVAL-07]
  // Chức năng: null / sai kiểu → 400; whitespace được chuẩn hóa ở service
  it("[TC-MVAL-07] null / sai kiểu → 400; whitespace được chuẩn hóa ở service", async () => {
    for (const raw of [
      { postId: POST_ID, content: null, clientId: "c1" },
      { postId: POST_ID, content: 123, clientId: "c1" },
      { postId: POST_ID, images: null, clientId: "c1" },
      { postId: POST_ID, images: "not-array", clientId: "c1" },
    ]) {
      const errors = await validate(toSendMessage(raw));
      expect(errors.length).toBeGreaterThan(0);
    }
  });

  // [WORD-TC: TC-MVAL-08]
  // Chức năng: quá 5 ảnh trước dedup → 400
  it("[TC-MVAL-08] quá 5 ảnh trước dedup → 400", async () => {
    const errors = await validate(
      toSendMessage({
        postId: POST_ID,
        images: ["a", "b", "c", "d", "e", "f"],
        clientId: "c1",
      }),
    );
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("SendConversationMessageDto alias (U1)", () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });

  // [WORD-TC: TC-MVAL-09]
  // Chức năng: body content-only đi qua DTO riêng
  it("[TC-MVAL-09] body content-only đi qua DTO riêng", async () => {
    const out = await pipe.transform(
      { content: "hello" },
      { type: "body", metatype: SendConversationMessageDto },
    );
    expect((out as SendConversationMessageDto).content).toBe("hello");
  });

  // [WORD-TC: TC-MVAL-10]
  // Chức năng: body gửi postId/conversationId → 400 (forbidNonWhitelisted)
  it("[TC-MVAL-10] body gửi postId/conversationId → 400 (forbidNonWhitelisted)", async () => {
    await expect(
      pipe.transform(
        { content: "hello", conversationId: CONV_ID },
        { type: "body", metatype: SendConversationMessageDto },
      ),
    ).rejects.toThrow();
    await expect(
      pipe.transform(
        { content: "hello", postId: POST_ID },
        { type: "body", metatype: SendConversationMessageDto },
      ),
    ).rejects.toThrow();
  });

  // [WORD-TC: TC-MVAL-11]
  // Chức năng: alias clientId optional; null không hợp lệ
  it("[TC-MVAL-11] alias clientId optional; null không hợp lệ", async () => {
    const without = plainToInstance(SendConversationMessageDto, {
      content: "hi",
    });
    expect(await validate(without)).toEqual([]);
    const nulled = plainToInstance(SendConversationMessageDto, {
      content: "hi",
      clientId: null,
    });
    expect((await validate(nulled)).length).toBeGreaterThan(0);
  });
});

describe("GetMessagesQueryDto / MarkReadDto", () => {
  // [WORD-TC: TC-MVAL-12]
  // Chức năng: Chấp nhận: decimal bigint deltas without converting to a JS number
  it("[TC-MVAL-12] Chấp nhận: decimal bigint deltas without converting to a JS number", async () => {
    for (const afterSequence of [
      "0",
      "9007199254740993",
      "9223372036854775807",
    ]) {
      const dto = plainToInstance(GetMessagesQueryDto, { afterSequence });
      expect(await validate(dto)).toEqual([]);
      expect(dto.afterSequence).toBe(afterSequence);
    }
    for (const afterSequence of [
      null,
      3,
      "-1",
      "",
      "01",
      "1e3",
      "1.5",
      "1".repeat(20),
    ]) {
      expect(
        (
          await validate(
            plainToInstance(GetMessagesQueryDto, { afterSequence }),
          )
        ).length,
      ).toBeGreaterThan(0);
    }
  });
  // [WORD-TC: TC-MVAL-13]
  // Chức năng: limit ngoài 1–100 → 400; before sai UUID/null → 400
  it("[TC-MVAL-13] limit ngoài 1–100 → 400; before sai UUID/null → 400", async () => {
    const over = plainToInstance(GetMessagesQueryDto, { limit: 101 });
    expect((await validate(over)).length).toBeGreaterThan(0);
    const badCursor = plainToInstance(GetMessagesQueryDto, {
      before: "nope",
    });
    expect((await validate(badCursor)).length).toBeGreaterThan(0);
    const nullCursor = plainToInstance(GetMessagesQueryDto, { before: null });
    expect((await validate(nullCursor)).length).toBeGreaterThan(0);
  });

  // [WORD-TC: TC-MVAL-14]
  // Chức năng: throughMessageId bắt buộc và UUID
  it("[TC-MVAL-14] throughMessageId bắt buộc và UUID", async () => {
    const missing = plainToInstance(MarkReadDto, {});
    expect((await validate(missing)).length).toBeGreaterThan(0);
    const bad = plainToInstance(MarkReadDto, { throughMessageId: "x" });
    expect((await validate(bad)).length).toBeGreaterThan(0);
    const ok = plainToInstance(MarkReadDto, { throughMessageId: CONV_ID });
    expect(await validate(ok)).toEqual([]);
  });
});
