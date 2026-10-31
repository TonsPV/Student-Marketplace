import "reflect-metadata";
import { Logger, NotFoundException } from "@nestjs/common";
import { DataSource, Not, Repository } from "typeorm";
import { AuthorizationService } from "../../src/modules/authorization/authorization.service";
import { CaslAbilityFactory } from "../../src/modules/authorization/casl-ability.factory";
import { ConversationsService } from "../../src/modules/conversations/conversations.service";
import {
  NotificationEntity,
  NotificationType,
} from "../../src/modules/notifications/notification.entity";
import { NotificationsService } from "../../src/modules/notifications/notifications.service";
import { RealtimeService } from "../../src/modules/realtime/realtime.service";
import { WS_EVENTS } from "../../src/modules/realtime/realtime.events";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const POST = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOTIFICATION = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("review notification reads", () => {
  const authorization = new AuthorizationService(new CaslAbilityFactory());
  const context = authorization.createAuthenticatedContext({
    id: USER,
    email: "buyer@example.test",
    fullName: "Buyer",
    isAdmin: false,
  });

  function setup(affected = 1) {
    const owned = Object.assign(new NotificationEntity(), {
      id: NOTIFICATION,
      userId: USER,
      type: NotificationType.REVIEW_REQUEST,
      refId: POST,
      isRead: false,
    });
    const repository = {
      findOneBy: jest.fn().mockResolvedValue(owned),
      update: jest.fn().mockResolvedValue({ affected }),
      query: jest.fn().mockResolvedValue([]),
    };
    const reviewUpdate = jest.fn().mockResolvedValue({ affected });
    const manager = {
      getRepository: jest.fn(() => ({ update: reviewUpdate })),
      query: jest.fn(),
    };
    let committed = false;
    const transaction = jest.fn(
      async (callback: (value: unknown) => Promise<unknown>) => {
        const result = await callback(manager);
        committed = true;
        return result;
      },
    );
    const conversations = {
      lockForAction: jest.fn(),
      bumpStateVersion: jest.fn(),
      buildSnapshot: jest.fn(),
      toUpdatedPayload: jest.fn(),
    };
    const realtime = { emitToUser: jest.fn() };
    const service = new NotificationsService(
      repository as unknown as Repository<NotificationEntity>,
      { transaction } as unknown as DataSource,
      conversations as unknown as ConversationsService,
      realtime as unknown as RealtimeService,
      authorization,
    );
    return {
      service,
      repository,
      reviewUpdate,
      manager,
      realtime,
      conversations,
      transaction,
      committed: () => committed,
    };
  }

  it("marks a review invitation read and invalidates all eligible user tabs", async () => {
    const { service, repository, realtime, conversations } = setup();
    await expect(service.markOneAsRead(context, NOTIFICATION)).resolves.toEqual(
      { updated: 1, snapshots: [] },
    );
    expect(repository.update).toHaveBeenCalledWith(
      { id: NOTIFICATION, userId: USER, isRead: false },
      { isRead: true },
    );
    expect(realtime.emitToUser).toHaveBeenCalledWith(
      USER,
      WS_EVENTS.NOTIFICATION_CHANGED,
      { type: NotificationType.REVIEW_REQUEST, refId: POST },
    );
    expect(conversations.lockForAction).not.toHaveBeenCalled();
  });

  it("does not emit when a repeated single read changes nothing", async () => {
    const { service, realtime } = setup(0);
    await expect(service.markOneAsRead(context, NOTIFICATION)).resolves.toEqual(
      { updated: 0, snapshots: [] },
    );
    expect(realtime.emitToUser).not.toHaveBeenCalled();
  });

  it("rejects a notification not owned by the caller", async () => {
    const { service, repository, realtime } = setup();
    repository.findOneBy.mockResolvedValue(null);
    await expect(
      service.markOneAsRead(context, NOTIFICATION),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.findOneBy).toHaveBeenCalledWith({
      id: NOTIFICATION,
      userId: USER,
    });
    expect(repository.update).not.toHaveBeenCalled();
    expect(realtime.emitToUser).not.toHaveBeenCalled();
  });

  it("reads an expiry notification without treating its post ID as a conversation", async () => {
    const state = setup();
    state.repository.findOneBy.mockResolvedValue(
      Object.assign(new NotificationEntity(), {
        id: NOTIFICATION,
        userId: USER,
        type: NotificationType.POST_EXPIRED,
        refId: POST,
      }),
    );
    await state.service.markOneAsRead(context, NOTIFICATION);
    expect(state.conversations.lockForAction).not.toHaveBeenCalled();
    expect(state.realtime.emitToUser).toHaveBeenCalledWith(
      USER,
      WS_EVENTS.NOTIFICATION_CHANGED,
      { type: NotificationType.POST_EXPIRED, refId: POST },
    );
  });

  it("reads review-only notifications and emits after transaction commit", async () => {
    const state = setup(2);
    state.realtime.emitToUser.mockImplementation(() => {
      expect(state.committed()).toBe(true);
    });
    await expect(state.service.markAllAsRead(context)).resolves.toEqual({
      updated: 2,
      snapshots: [],
    });
    expect(state.reviewUpdate).toHaveBeenCalledWith(
      { userId: USER, type: Not(NotificationType.NEW_MESSAGE), isRead: false },
      { isRead: true },
    );
    expect(state.realtime.emitToUser).toHaveBeenCalledWith(
      USER,
      WS_EVENTS.NOTIFICATION_CHANGED,
      { scope: "non_message", refId: null },
    );
    expect(state.conversations.lockForAction).not.toHaveBeenCalled();
  });

  it("counts mixed message and review reads while preserving chat snapshots", async () => {
    const state = setup(2);
    const conversationId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    state.repository.query.mockResolvedValue([{ ref_id: conversationId }]);
    const message = Object.assign(new NotificationEntity(), {
      id: "message-notification",
      type: NotificationType.NEW_MESSAGE,
      refId: conversationId,
    });
    jest.spyOn(state.service, "findUnread").mockResolvedValue(message);
    state.conversations.bumpStateVersion.mockResolvedValue("3");
    state.manager.query.mockResolvedValue([message]);
    const snapshot = {
      conversationId,
      stateVersion: "3",
      unreadNotification: null,
      changed: [NotificationsService.toResponse(message)],
    };
    jest.spyOn(state.service, "buildSnapshot").mockResolvedValue(snapshot);
    state.conversations.buildSnapshot.mockResolvedValue({ id: conversationId });
    await expect(state.service.markAllAsRead(context)).resolves.toEqual({
      updated: 3,
      snapshots: [snapshot],
    });
    expect(state.realtime.emitToUser).toHaveBeenCalledWith(
      USER,
      WS_EVENTS.NOTIFICATION_CHANGED,
      snapshot,
    );
    expect(state.realtime.emitToUser).toHaveBeenCalledWith(
      USER,
      WS_EVENTS.NOTIFICATION_CHANGED,
      { scope: "non_message", refId: null },
    );
  });

  it("does not emit for read-all when nothing changes", async () => {
    const { service, realtime } = setup(0);
    await expect(service.markAllAsRead(context)).resolves.toEqual({
      updated: 0,
      snapshots: [],
    });
    expect(realtime.emitToUser).not.toHaveBeenCalled();
  });

  it("does not emit when the read-all transaction fails", async () => {
    const state = setup();
    state.reviewUpdate.mockRejectedValue(new Error("database failure"));
    await expect(state.service.markAllAsRead(context)).rejects.toThrow(
      "database failure",
    );
    expect(state.committed()).toBe(false);
    expect(state.realtime.emitToUser).not.toHaveBeenCalled();
  });

  it.each(["single", "all"])(
    "keeps the %s read successful if realtime throws",
    async (mode) => {
      const state = setup();
      state.realtime.emitToUser.mockImplementation(() => {
        throw new Error("socket failure");
      });
      const log = jest
        .spyOn(Logger.prototype, "error")
        .mockImplementation(() => undefined);
      try {
        const read =
          mode === "single"
            ? state.service.markOneAsRead(context, NOTIFICATION)
            : state.service.markAllAsRead(context);
        await expect(read).resolves.toEqual({ updated: 1, snapshots: [] });
        expect(log).toHaveBeenCalledWith(
          expect.stringContaining("socket failure"),
        );
      } finally {
        log.mockRestore();
      }
    },
  );
});
