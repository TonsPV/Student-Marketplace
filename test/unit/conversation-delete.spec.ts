import "reflect-metadata";
import { ForbiddenException } from "@nestjs/common";
import { DataSource } from "typeorm";
import { MessagesService } from "../../src/modules/messages/messages.service";
import { ConversationsService } from "../../src/modules/conversations/conversations.service";
import { NotificationsService } from "../../src/modules/notifications/notifications.service";
import { StorageService } from "../../src/modules/storage/storage.service";
import { RealtimeService } from "../../src/modules/realtime/realtime.service";
import { AuthorizationService } from "../../src/modules/authorization/authorization.service";
import { CaslAbilityFactory } from "../../src/modules/authorization/casl-ability.factory";

describe("participant conversation deletion", () => {
  const authorization = new AuthorizationService(new CaslAbilityFactory());
  const ids: Record<string, string> = {
    buyer: "11111111-1111-4111-8111-111111111111",
    seller: "22222222-2222-4222-8222-222222222222",
    outsider: "33333333-3333-4333-8333-333333333333",
  };
  const principal = (id: string) =>
    authorization.createAuthenticatedContext({
      id: ids[id],
      email: "test@example.test",
      fullName: "Test",
      isAdmin: false,
    });
  it.each([
    ["buyer", false],
    ["seller", false],
    ["buyer", true],
    ["seller", true],
  ] as const)(
    "hides only %s, is idempotent, and emits only after commit (notification=%s)",
    async (actor, hasNotification) => {
      const conv = {
        id: "44444444-4444-4444-8444-444444444444",
        postId: "55555555-5555-4555-8555-555555555555",
        buyerId: ids.buyer,
        sellerId: ids.seller,
        buyerDeletedAt: null as Date | null,
        sellerDeletedAt: null as Date | null,
        stateVersion: "9007199254740993",
      };
      let committed = false,
        unreadNotification = hasNotification;
      const query = jest.fn(async (sql: string, args: string[]) => {
        expect(sql).not.toMatch(/UPDATE messages|DELETE FROM/i);
        if (sql.includes("UPDATE notifications")) {
          expect(args[1]).toBe(ids[actor]);
          expect(args[2]).toBe("9007199254740994");
          unreadNotification = false;
          return [{ updated_at: new Date() }];
        }
        expect(sql).toContain(`${actor}_deleted_at`);
        expect(sql).not.toContain(
          `${actor === "buyer" ? "seller" : "buyer"}_deleted_at`,
        );
        conv[actor === "buyer" ? "buyerDeletedAt" : "sellerDeletedAt"] =
          new Date();
        conv.stateVersion = args[1];
        return [];
      });
      const manager = { query };
      const conversations = {
        lockForAction: jest.fn(async (_manager, _id, ctx, action) => {
          authorization.assertResource(ctx, action, "Conversation", conv);
          return conv;
        }),
        buildSnapshot: jest.fn(async () => ({
          id: conv.id,
          stateVersion: conv.stateVersion,
          deletedAt:
            conv[actor === "buyer" ? "buyerDeletedAt" : "sellerDeletedAt"],
          unreadCount: 0,
        })),
        toUpdatedPayload: (snapshot: object) => snapshot,
      };
      const realtime = {
        emitToUser: jest.fn(
          (_userId: string, _event: string, _payload: unknown) => {
            expect(committed).toBe(true);
          },
        ),
        emitToConversation: jest.fn(),
      };
      const notifications = {
        findUnread: jest.fn(async () =>
          unreadNotification
            ? {
                id: "notice",
                isRead: false,
                createdAt: new Date(),
                updatedAt: new Date(),
              }
            : null,
        ),
        buildSnapshot: jest.fn(async () => ({})),
      };
      const service = new MessagesService(
        {
          transaction: async (
            run: (manager: { query: typeof query }) => Promise<unknown>,
          ) => {
            committed = false;
            const value = await run(manager);
            committed = true;
            return value;
          },
        } as unknown as DataSource,
        conversations as unknown as ConversationsService,
        notifications as unknown as NotificationsService,
        {} as StorageService,
        realtime as unknown as RealtimeService,
        authorization,
      );
      const ctx = principal(actor);
      const first = await service.deleteConversation(conv.id, ctx);
      expect(first.deletedAt).toBeInstanceOf(Date);
      expect(first.stateVersion).toBe("9007199254740994");
      const again = await service.deleteConversation(conv.id, ctx);
      expect(again).toEqual(first);
      expect(query).toHaveBeenCalledTimes(hasNotification ? 2 : 1);
      expect(conversations.lockForAction).toHaveBeenCalledWith(
        manager,
        conv.id,
        ctx,
        "delete",
      );
      expect(
        realtime.emitToUser.mock.calls.every((call) => call[0] === ids[actor]),
      ).toBe(true);
      expect(realtime.emitToConversation).not.toHaveBeenCalled();
      await expect(
        service.deleteConversation(conv.id, principal("outsider")),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(query).toHaveBeenCalledTimes(hasNotification ? 2 : 1);
    },
  );
});
