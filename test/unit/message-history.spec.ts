/**
 * MODULE: CONVERSATIONS & MESSAGES
 *
 * WORD TEST CASES:
 * - TC-MHIS-01: Sử dụng: bigint bounds and limit+1, with authorization before querying
 * - TC-MHIS-02: Trả về: an empty delta without loading or signing any older message
 * - TC-MHIS-03: Từ chối: invalid bounds before SQL: -1
 * - TC-MHIS-04: Từ chối: invalid bounds before SQL:
 * - TC-MHIS-05: Từ chối: invalid bounds before SQL: 01
 * - TC-MHIS-06: Từ chối: invalid bounds before SQL: 1e3
 * - TC-MHIS-07: Từ chối: invalid bounds before SQL: 1.2
 * - TC-MHIS-08: Từ chối: invalid bounds before SQL: 9223372036854775808
 * - TC-MHIS-09: Không query history for a nonparticipant
 */

import "reflect-metadata";
import { ForbiddenException } from "@nestjs/common";
import { DataSource } from "typeorm";
import { ConversationsService } from "../../src/modules/conversations/conversations.service";
import { MessagesService } from "../../src/modules/messages/messages.service";
import { NotificationsService } from "../../src/modules/notifications/notifications.service";
import { RealtimeService } from "../../src/modules/realtime/realtime.service";
import { StorageService } from "../../src/modules/storage/storage.service";
import { AuthorizationService } from "../../src/modules/authorization/authorization.service";
import { CaslAbilityFactory } from "../../src/modules/authorization/casl-ability.factory";

describe("message history deltas", () => {
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const authorization = new AuthorizationService(new CaslAbilityFactory());
  const context = authorization.createAuthenticatedContext({
    id,
    email: "test@example.test",
    fullName: "Test",
    isAdmin: false,
  });
  const messages = [
    "9007199254740993",
    "9007199254740994",
    "9007199254740995",
  ].map((sequence, index) => ({
    id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(index).padStart(12, "0")}`,
    conversationId: id,
    senderId: id,
    sequence,
    content: sequence,
    images: [],
    clientId: null,
    isRead: false,
    createdAt: new Date(),
  }));
  let service: MessagesService;
  let query: jest.Mock, find: jest.Mock, getForAction: jest.Mock;
  beforeEach(() => {
    let selected: typeof messages = [];
    query = jest
      .fn()
      .mockImplementation(async (sql: string, args: unknown[]) => {
        if (sql.startsWith("SELECT sequence"))
          return messages
            .filter((message) => message.id === args[0])
            .map((message) => ({ sequence: message.sequence }));
        expect(sql).toContain("sequence > $4::bigint");
        const [, before, limit, after] = args as [
          string,
          string | null,
          number,
          string | null,
        ];
        selected = [...messages]
          .reverse()
          .filter(
            (message) =>
              (before === null || BigInt(message.sequence) < BigInt(before)) &&
              (after === null || BigInt(message.sequence) > BigInt(after)),
          )
          .slice(0, limit);
        return selected.map(({ id, sequence }) => ({ id, sequence }));
      });
    find = jest.fn().mockImplementation(async () => selected.slice(0, -1));
    getForAction = jest.fn().mockResolvedValue({ id });
    service = new MessagesService(
      { query, getRepository: () => ({ find }) } as unknown as DataSource,
      { getForAction } as unknown as ConversationsService,
      {} as NotificationsService,
      {
        presignGetMany: async () => ({ urls: [], expiresAt: null }),
      } as unknown as StorageService,
      {} as RealtimeService,
      authorization,
    );
  });

  // [WORD-TC: TC-MHIS-01]
  // Chức năng: Sử dụng: bigint bounds and limit+1, with authorization before querying
  it("[TC-MHIS-01] Sử dụng: bigint bounds and limit+1, with authorization before querying", async () => {
    find.mockResolvedValue([messages[2]]);
    const page = await service.findMessages(id, context, {
      limit: 1,
      afterSequence: messages[0].sequence,
    });
    expect(getForAction).toHaveBeenCalledWith(id, context, "readMessages");
    expect(getForAction.mock.invocationCallOrder[0]).toBeLessThan(
      query.mock.invocationCallOrder[0],
    );
    expect(query.mock.calls[0][1]).toEqual([id, null, 2, messages[0].sequence]);
    expect(page).toMatchObject({ hasMore: true, nextCursor: messages[2].id });
    expect(page.items[0].sequence).toBe("9007199254740995");
    find.mockResolvedValue([messages[1]]);
    const next = await service.findMessages(id, context, {
      limit: 1,
      afterSequence: messages[0].sequence,
      before: page.nextCursor!,
    });
    expect(next.items.map((message) => message.sequence)).toEqual([
      messages[1].sequence,
    ]);
    expect(next.hasMore).toBe(false);
    expect(query.mock.calls.at(-1)[1]).toEqual([
      id,
      messages[2].sequence,
      2,
      messages[0].sequence,
    ]);
  });

  // [WORD-TC: TC-MHIS-02]
  // Chức năng: Trả về: an empty delta without loading or signing any older message
  it("[TC-MHIS-02] Trả về: an empty delta without loading or signing any older message", async () => {
    expect(
      await service.findMessages(id, context, {
        limit: 30,
        afterSequence: messages[2].sequence,
      }),
    ).toEqual({ items: [], hasMore: false, nextCursor: null });
    expect(find).not.toHaveBeenCalled();
  });

  // [WORD-TC: TC-MHIS-03]
  // Chức năng: Từ chối: invalid bounds before SQL: -1
  // [WORD-TC: TC-MHIS-04]
  // Chức năng: Từ chối: invalid bounds before SQL:
  // [WORD-TC: TC-MHIS-05]
  // Chức năng: Từ chối: invalid bounds before SQL: 01
  // [WORD-TC: TC-MHIS-06]
  // Chức năng: Từ chối: invalid bounds before SQL: 1e3
  // [WORD-TC: TC-MHIS-07]
  // Chức năng: Từ chối: invalid bounds before SQL: 1.2
  // [WORD-TC: TC-MHIS-08]
  // Chức năng: Từ chối: invalid bounds before SQL: 9223372036854775808
  it.each(["-1", "", "01", "1e3", "1.2", "9223372036854775808"])(
    "[TC-MHIS] Từ chối afterSequence không hợp lệ trước khi truy vấn SQL: %s",
    async (afterSequence) => {
      await expect(
        service.findMessages(id, context, { limit: 30, afterSequence }),
      ).rejects.toMatchObject({ status: 400 });
      expect(query).not.toHaveBeenCalled();
    },
  );

  // [WORD-TC: TC-MHIS-09]
  // Chức năng: Không query history for a nonparticipant
  it("[TC-MHIS-09] Không query history for a nonparticipant", async () => {
    getForAction.mockRejectedValue(new ForbiddenException());
    await expect(
      service.findMessages(id, context, { limit: 30, afterSequence: "0" }),
    ).rejects.toMatchObject({ status: 403 });
    expect(query).not.toHaveBeenCalled();
  });
});
