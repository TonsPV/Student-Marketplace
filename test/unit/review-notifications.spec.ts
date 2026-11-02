/**
 * MODULE: NOTIFICATIONS (THÔNG BÁO)
 *
 * WORD TEST CASES:
 * - TC-RNOT-01: Đánh dấu lời mời review đã đọc và vô hiệu hóa mọi tab hợp lệ của user
 * - TC-RNOT-02: Đọc lặp không thay đổi gì → không emit
 * - TC-RNOT-03: Từ chối notification không thuộc sở hữu của người gọi
 * - TC-RNOT-04: Đọc notification hết hạn mà không nhầm postId thành conversationId
 * - TC-RNOT-05: Đọc notification review và chỉ emit sau khi transaction commit
 * - TC-RNOT-06: Đếm đồng thời read tin nhắn và review mà vẫn giữ chat snapshot
 * - TC-RNOT-07: read-all không thay đổi gì → không emit
 * - TC-RNOT-08: read-all khi transaction thất bại → không emit
 * - TC-RNOT-09: Đọc đơn vẫn thành công dù realtime ném lỗi
 * - TC-RNOT-10: Đọc tất cả vẫn thành công dù realtime ném lỗi
 */

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

  // [WORD-TC: TC-RNOT-01]
  // Chức năng: Đánh dấu lời mời review đã đọc và vô hiệu hóa mọi tab hợp lệ của user
  it("[TC-RNOT-01] Đánh dấu lời mời review đã đọc và vô hiệu hóa mọi tab hợp lệ của user", async () => {
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

  // [WORD-TC: TC-RNOT-02]
  // Chức năng: Đọc lặp không thay đổi gì → không emit
  it("[TC-RNOT-02] Đọc lặp không thay đổi gì → không emit", async () => {
    const { service, realtime } = setup(0);
    await expect(service.markOneAsRead(context, NOTIFICATION)).resolves.toEqual(
      { updated: 0, snapshots: [] },
    );
    expect(realtime.emitToUser).not.toHaveBeenCalled();
  });

  // [WORD-TC: TC-RNOT-03]
  // Chức năng: Từ chối notification không thuộc sở hữu của người gọi
  it("[TC-RNOT-03] Từ chối notification không thuộc sở hữu của người gọi", async () => {
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

  // [WORD-TC: TC-RNOT-04]
  // Chức năng: Đọc notification hết hạn mà không nhầm postId thành conversationId
  it("[TC-RNOT-04] Đọc notification hết hạn mà không nhầm postId thành conversationId", async () => {
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

  // [WORD-TC: TC-RNOT-05]
  // Chức năng: Đọc notification review và chỉ emit sau khi transaction commit
  it("[TC-RNOT-05] Đọc notification review và chỉ emit sau khi transaction commit", async () => {
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

  // [WORD-TC: TC-RNOT-06]
  // Chức năng: Đếm đồng thời read tin nhắn và review mà vẫn giữ chat snapshot
  it("[TC-RNOT-06] Đếm đồng thời read tin nhắn và review mà vẫn giữ chat snapshot", async () => {
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

  // [WORD-TC: TC-RNOT-07]
  // Chức năng: read-all không thay đổi gì → không emit
  it("[TC-RNOT-07] read-all không thay đổi gì → không emit", async () => {
    const { service, realtime } = setup(0);
    await expect(service.markAllAsRead(context)).resolves.toEqual({
      updated: 0,
      snapshots: [],
    });
    expect(realtime.emitToUser).not.toHaveBeenCalled();
  });

  // [WORD-TC: TC-RNOT-08]
  // Chức năng: read-all khi transaction thất bại → không emit
  it("[TC-RNOT-08] read-all khi transaction thất bại → không emit", async () => {
    const state = setup();
    state.reviewUpdate.mockRejectedValue(new Error("database failure"));
    await expect(state.service.markAllAsRead(context)).rejects.toThrow(
      "database failure",
    );
    expect(state.committed()).toBe(false);
    expect(state.realtime.emitToUser).not.toHaveBeenCalled();
  });

  // [WORD-TC: TC-RNOT-09]
  // Chức năng: Đọc đơn vẫn thành công dù realtime ném lỗi
  // [WORD-TC: TC-RNOT-10]
  // Chức năng: Đọc tất cả vẫn thành công dù realtime ném lỗi
  it.each(["single", "all"])(
    "[TC-RNOT] Thao tác đọc thông báo (%s) vẫn thành công dù realtime gặp lỗi",
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
