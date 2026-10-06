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
  it("thiếu cả hai → 400", async () => {
    const errors = await validate(
      toSendMessage({ content: "hi", clientId: "c1" }),
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it("cả hai → 400", async () => {
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

  it("null / rỗng / sai UUID → 400", async () => {
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

  it("đúng một UUID hợp lệ + clientId → pass", async () => {
    for (const raw of [
      { postId: POST_ID, content: "hi", clientId: "c1" },
      { conversationId: CONV_ID, images: ["k"], clientId: "c1" },
    ]) {
      const errors = await validate(toSendMessage(raw));
      expect(errors).toEqual([]);
    }
  });

  it("E1 thiếu clientId → 400; clientId rỗng sau trim → 400", async () => {
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
  it("quá 2000 ký tự sau trim → 400", async () => {
    const errors = await validate(
      toSendMessage({
        postId: POST_ID,
        content: ` ${"a".repeat(2001)} `,
        clientId: "c1",
      }),
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it("null / sai kiểu → 400; whitespace được chuẩn hóa ở service", async () => {
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

  it("quá 5 ảnh trước dedup → 400", async () => {
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

  it("body content-only đi qua DTO riêng", async () => {
    const out = await pipe.transform(
      { content: "hello" },
      { type: "body", metatype: SendConversationMessageDto },
    );
    expect((out as SendConversationMessageDto).content).toBe("hello");
  });

  it("body gửi postId/conversationId → 400 (forbidNonWhitelisted)", async () => {
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

  it("alias clientId optional; null không hợp lệ", async () => {
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
  it("limit ngoài 1–100 → 400; before sai UUID/null → 400", async () => {
    const over = plainToInstance(GetMessagesQueryDto, { limit: 101 });
    expect((await validate(over)).length).toBeGreaterThan(0);
    const badCursor = plainToInstance(GetMessagesQueryDto, {
      before: "nope",
    });
    expect((await validate(badCursor)).length).toBeGreaterThan(0);
    const nullCursor = plainToInstance(GetMessagesQueryDto, { before: null });
    expect((await validate(nullCursor)).length).toBeGreaterThan(0);
  });

  it("throughMessageId bắt buộc và UUID", async () => {
    const missing = plainToInstance(MarkReadDto, {});
    expect((await validate(missing)).length).toBeGreaterThan(0);
    const bad = plainToInstance(MarkReadDto, { throughMessageId: "x" });
    expect((await validate(bad)).length).toBeGreaterThan(0);
    const ok = plainToInstance(MarkReadDto, { throughMessageId: CONV_ID });
    expect(await validate(ok)).toEqual([]);
  });
});
