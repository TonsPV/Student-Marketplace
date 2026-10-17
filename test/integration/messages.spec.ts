import { DataSource } from "typeorm";
import { uuidv7 } from "uuidv7";
import { ConversationsService } from "../../src/modules/conversations/conversations.service";
import { ConversationEntity } from "../../src/modules/conversations/entities/conversation.entity";
import { MessagesService } from "../../src/modules/messages/messages.service";
import { MessageEntity } from "../../src/modules/messages/entities/message.entity";
import { NotificationEntity } from "../../src/modules/notifications/notification.entity";
import { NotificationsService } from "../../src/modules/notifications/notifications.service";
import { PostEntity, PostStatus } from "../../src/modules/posts/post.entity";
import { RealtimeService } from "../../src/modules/realtime/realtime.service";
import { StorageService } from "../../src/modules/storage/storage.service";
import { UserEntity } from "../../src/modules/user/user.entity";
import { PostImageEntity } from "../../src/modules/post-images/post-image.entity";
import { AuthorizationService } from "../../src/modules/authorization/authorization.service";
import { CaslAbilityFactory } from "../../src/modules/authorization/casl-ability.factory";
import type { AuthenticatedContext } from "../../src/modules/authorization/authorization.types";
import {
  createTestDataSource,
  initializeTestDatabase,
  disposeTestDatabase,
} from "./database";
import {
  cleanFixtures,
  createTestCategory,
  createTestPost,
  createTestUser,
} from "./fixtures";

describe("messages on PostgreSQL: locks, transactions, replay, reads", () => {
  let ds: DataSource;
  let conversations: ConversationsService;
  let notifications: NotificationsService;
  let messages: MessagesService;
  let buyer: UserEntity;
  let seller: UserEntity;
  let outsider: UserEntity;
  let post: PostEntity;
  const realtime = { emitToUser: jest.fn(), emitToConversation: jest.fn() };
  const storage = {
    maxFileSizeBytes: 5242880,
    headObject: jest.fn(),
    presignGetMany: jest.fn(),
    presignGet: jest.fn(),
  };
  const authorization = new AuthorizationService(new CaslAbilityFactory());
  const context = (user: UserEntity): AuthenticatedContext =>
    authorization.createAuthenticatedContext(user);
  const send = (content: string, clientId = uuidv7()) =>
    messages.sendMessage(context(buyer), {
      postId: post.id,
      content,
      clientId,
    });
  const state = (id: string) =>
    ds.getRepository(ConversationEntity).findOneByOrFail({ id });

  it("soft-deletes only one participant, preserves history/read state, restores on new send", async () => {
    const first = await send("original");
    const id = first.conversationId;
    const before = await state(id);
    realtime.emitToUser.mockClear();
    await expect(
      messages.deleteConversation(id, context(outsider)),
    ).rejects.toMatchObject({ status: 403 });
    const deleted = await messages.deleteConversation(id, context(seller));
    expect(deleted.deletedAt).toBeTruthy();
    expect(
      (await conversations.findAll(context(seller), { page: 1, limit: 30 }))
        .items,
    ).toHaveLength(0);
    expect(
      (await conversations.findAll(context(buyer), { page: 1, limit: 30 }))
        .items,
    ).toHaveLength(1);
    expect(await messages.getUnreadCount(context(seller))).toEqual({
      total: 0,
      conversations: 0,
    });
    expect(
      await ds
        .getRepository(MessageEntity)
        .countBy({ conversationId: id, isRead: false }),
    ).toBe(1);
    expect((await state(id)).sellerReadSequence).toBe(
      before.sellerReadSequence,
    );
    expect(
      await ds
        .getRepository(NotificationEntity)
        .countBy({ userId: seller.id, refId: id, isRead: false }),
    ).toBe(0);
    expect(
      realtime.emitToUser.mock.calls.every(([userId]) => userId === seller.id),
    ).toBe(true);
    const retry = await messages.deleteConversation(id, context(seller));
    expect(retry.stateVersion).toBe(deleted.stateVersion);
    expect(retry.deletedAt).toEqual(deleted.deletedAt);
    expect(
      (await messages.findMessages(id, context(buyer), { limit: 30 })).items,
    ).toHaveLength(1);
    await send("new message");
    expect(
      (await conversations.findAll(context(seller), { page: 1, limit: 30 }))
        .items,
    ).toHaveLength(1);
    expect((await state(id)).sellerDeletedAt).toBeNull();
    expect(
      (await messages.findMessages(id, context(seller), { limit: 30 })).items,
    ).toHaveLength(2);
    await messages.deleteConversation(id, context(buyer));
    const reopened = await conversations.createConversation(
      { postId: post.id },
      context(buyer),
    );
    expect(reopened.id).toBe(id);
    expect(reopened.deletedAt).toBeNull();
    expect(await ds.getRepository(ConversationEntity).countBy({ id })).toBe(1);
  });

  it("serializes simultaneous send/delete with no message loss", async () => {
    const first = await send("before race");
    const id = first.conversationId;
    await Promise.all([
      messages.deleteConversation(id, context(seller)),
      send("during race"),
    ]);
    const final = await state(id);
    expect(final.lastMessageSequence).toBe("2");
    expect(BigInt(final.stateVersion)).toBe(3n);
    expect(
      await ds.getRepository(MessageEntity).countBy({ conversationId: id }),
    ).toBe(2);
    const visible = await conversations.findAll(context(seller), {
      page: 1,
      limit: 30,
    });
    expect(visible.items.length).toBe(final.sellerDeletedAt ? 0 : 1);
  });

  beforeAll(async () => {
    ds = createTestDataSource();
    await initializeTestDatabase(ds);
    conversations = new ConversationsService(
      ds.getRepository(ConversationEntity),
      ds.getRepository(PostEntity),
      ds,
      authorization,
      storage as unknown as StorageService,
    );
    notifications = new NotificationsService(
      ds.getRepository(NotificationEntity),
      ds,
      conversations,
      realtime as unknown as RealtimeService,
      authorization,
    );
    messages = new MessagesService(
      ds,
      conversations,
      notifications,
      storage as unknown as StorageService,
      realtime as unknown as RealtimeService,
      authorization,
    );
  });
  afterAll(async () => {
    if (ds) await disposeTestDatabase(ds);
  });
  beforeEach(async () => {
    await cleanFixtures(ds);
    jest.restoreAllMocks();
    realtime.emitToUser.mockReset();
    realtime.emitToConversation.mockReset();
    storage.headObject
      .mockReset()
      .mockResolvedValue({ contentLength: 68, contentType: "image/png" });
    storage.presignGetMany
      .mockReset()
      .mockImplementation(async (keys: string[]) => ({
        urls: keys.map((key) => `https://test.invalid/${key}`),
        expiresAt: keys.length
          ? new Date(Date.now() + 900000).toISOString()
          : null,
      }));
    [buyer, seller, outsider] = await Promise.all([
      createTestUser(ds),
      createTestUser(ds),
      createTestUser(ds),
    ]);
    const category = await createTestCategory(ds);
    post = await createTestPost(ds, seller.id, category.id);
  });

  it("concurrent first sends create one conversation and contiguous sequences; metadata is latest", async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => send(`message ${i}`)),
    );
    expect(new Set(results.map((m) => m.conversationId)).size).toBe(1);
    expect(
      results.map((m) => Number(m.sequence)).sort((a, b) => a - b),
    ).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    const latest = results.find((m) => m.sequence === "12")!;
    expect(latest.conversation).toMatchObject({
      id: latest.conversationId,
      role: "buyer",
      counterpart: { id: seller.id },
      lastMessageId: latest.id,
      stateVersion: "12",
    });
    for (const call of realtime.emitToConversation.mock.calls)
      expect(call[2]).not.toHaveProperty("conversation");
    expect(await state(latest.conversationId)).toMatchObject({
      lastMessageId: latest.id,
      lastMessageSequence: "12",
      stateVersion: "12",
      lastMessage: latest.content,
    });
    expect(await notifications.getUnreadCount(context(seller))).toEqual({
      total: 1,
    });
    expect(await messages.getUnreadCount(context(seller))).toEqual({
      total: 12,
      conversations: 1,
    });
    expect(await messages.getUnreadCount(context(buyer))).toEqual({
      total: 0,
      conversations: 0,
    });
    expect(realtime.emitToConversation).toHaveBeenCalledTimes(12);
  });

  it("parallel same clientId returns one saved message and emits once; changed payload is 409", async () => {
    const clientId = uuidv7();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => send("hello", clientId)),
    );
    expect(new Set(results.map((m) => m.id)).size).toBe(1);
    expect(await ds.getRepository(MessageEntity).count()).toBe(1);
    expect(realtime.emitToConversation).toHaveBeenCalledTimes(1);
    await expect(send("different", clientId)).rejects.toMatchObject({
      status: 409,
    });
    await ds
      .getRepository(PostEntity)
      .update(post.id, { status: PostStatus.SOLD });
    expect((await send("hello", clientId)).id).toBe(results[0].id);
    expect(
      (
        await messages.sendMessage(context(buyer), {
          conversationId: results[0].conversationId,
          content: " hello ",
          clientId,
        })
      ).id,
    ).toBe(results[0].id);
    await expect(send("new")).rejects.toMatchObject({ status: 404 });
    await messages.sendMessage(context(seller), {
      conversationId: results[0].conversationId,
      content: "reply",
      clientId,
    });
    expect(await ds.getRepository(MessageEntity).count()).toBe(2);
  });

  it("notification failure rolls back conversation, message and metadata with no emits", async () => {
    const spy = jest
      .spyOn(notifications, "upsertNewMessage")
      .mockRejectedValueOnce(new Error("injected failure"));
    await expect(send("rollback")).rejects.toThrow("injected failure");
    expect(await ds.getRepository(ConversationEntity).count()).toBe(0);
    expect(await ds.getRepository(MessageEntity).count()).toBe(0);
    expect(realtime.emitToConversation).not.toHaveBeenCalled();
    spy.mockRestore();
    expect((await send("next")).sequence).toBe("1");
  });

  it("signing failure creates no rows; emit failure still returns persisted success", async () => {
    storage.presignGetMany.mockRejectedValueOnce(new Error("signing failure"));
    await expect(send("failed")).rejects.toThrow("signing failure");
    expect(await ds.getRepository(MessageEntity).count()).toBe(0);
    realtime.emitToConversation.mockImplementationOnce(() => {
      throw new Error("socket failure");
    });
    const saved = await send("committed");
    expect(
      await ds.getRepository(MessageEntity).findOneBy({ id: saved.id }),
    ).not.toBeNull();
  });

  it("read counts actual incoming rows, leaves later messages unread, and repeating/older reads are no-ops", async () => {
    const first = await send("first");
    const reply = await messages.sendMessage(context(seller), {
      conversationId: first.conversationId,
      content: "reply",
      clientId: uuidv7(),
    });
    const third = await send("third");
    expect(
      await messages.markAsRead(first.conversationId, context(seller), {
        throughMessageId: reply.id,
      }),
    ).toMatchObject({
      updated: 1,
      unreadCount: 1,
      readThroughSequence: "2",
      stateVersion: "4",
      conversation: {
        id: first.conversationId,
        role: "seller",
        unreadCount: 1,
        stateVersion: "4",
      },
    });
    realtime.emitToConversation.mockClear();
    realtime.emitToUser.mockClear();
    expect(
      await messages.markAsRead(first.conversationId, context(seller), {
        throughMessageId: first.id,
      }),
    ).toMatchObject({
      updated: 0,
      unreadCount: 1,
      readThroughSequence: "2",
      stateVersion: "4",
    });
    expect(realtime.emitToConversation).not.toHaveBeenCalled();
    expect(realtime.emitToUser).not.toHaveBeenCalled();
    expect(
      await messages.markAsRead(first.conversationId, context(seller), {
        throughMessageId: third.id,
      }),
    ).toMatchObject({ updated: 1, unreadCount: 0, stateVersion: "5" });
    const list = await notifications.getList(context(seller), {
      page: 1,
      limit: 10,
    });
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({
      isRead: true,
      conversationVersion: "5",
    });
    expect(list.snapshots[0]).toMatchObject({
      stateVersion: "5",
      unreadNotification: null,
    });
    expect(
      await messages.markAsRead(first.conversationId, context(seller), {
        throughMessageId: third.id,
      }),
    ).toMatchObject({ updated: 0, stateVersion: "5" });
  });

  it("manual notification read affects no messages; subsequent send creates a new unread notification", async () => {
    const first = await send("first");
    const noti = await ds
      .getRepository(NotificationEntity)
      .findOneByOrFail({ userId: seller.id });
    const read = await notifications.markOneAsRead(context(seller), noti.id);
    expect(read.updated).toBe(1);
    expect(read.snapshots[0].changed).toHaveLength(1);
    expect(read.snapshots[0].changed[0]).toMatchObject({
      id: noti.id,
      isRead: true,
    });
    expect(await messages.getUnreadCount(context(seller))).toEqual({
      total: 1,
      conversations: 1,
    });
    expect((await state(first.conversationId)).sellerReadSequence).toBe("0");
    expect(
      (await notifications.markOneAsRead(context(seller), noti.id)).updated,
    ).toBe(0);
    await send("second");
    expect(await ds.getRepository(NotificationEntity).count()).toBe(2);
    const all = await notifications.markAllAsRead(context(seller));
    expect(all.updated).toBe(1);
    expect(all.snapshots[0].changed[0].isRead).toBe(true);
    expect(await messages.getUnreadCount(context(seller))).toEqual({
      total: 2,
      conversations: 1,
    });
    expect(await notifications.markAllAsRead(context(seller))).toEqual({
      updated: 0,
      snapshots: [],
    });
  });

  it("concurrent send/read/manual notification read preserve counts and versions", async () => {
    const first = await send("first");
    const noti = await ds
      .getRepository(NotificationEntity)
      .findOneByOrFail({ userId: seller.id });
    await Promise.all([
      send("second"),
      messages.markAsRead(first.conversationId, context(seller), {
        throughMessageId: first.id,
      }),
      notifications.markOneAsRead(context(seller), noti.id),
      notifications.markAllAsRead(context(seller)),
    ]);
    expect(await messages.getUnreadCount(context(seller))).toEqual({
      total: 1,
      conversations: 1,
    });
    expect((await state(first.conversationId)).sellerReadSequence).toBe("1");
    const unread = await ds
      .getRepository(NotificationEntity)
      .findBy({ userId: seller.id, isRead: false });
    expect(unread.length).toBeLessThanOrEqual(1);
    if (unread[0]) expect(unread[0].lastMessageSequence).toBe("2");
  });

  it("images dedup preserves order; reused key rolls back; history pages whole messages", async () => {
    const keys = Array.from(
      { length: 3 },
      () => `messages/${buyer.id}/${uuidv7()}.png`,
    );
    const first = await messages.sendMessage(context(buyer), {
      postId: post.id,
      images: [keys[0], keys[1], keys[0], keys[2]],
      clientId: uuidv7(),
    });
    expect(first.images).toEqual(
      keys.map((key) => `https://test.invalid/${key}`),
    );
    await expect(
      messages.sendMessage(context(buyer), {
        conversationId: first.conversationId,
        images: [keys[0]],
        clientId: uuidv7(),
      }),
    ).rejects.toMatchObject({ status: 409 });
    const second = await send("second");
    expect(second.sequence).toBe("2");
    const page = await messages.findMessages(
      first.conversationId,
      context(seller),
      {
        limit: 1,
      },
    );
    expect(page.items.map((m) => m.id)).toEqual([second.id]);
    expect(page.hasMore).toBe(true);
    const delta = await messages.findMessages(
      first.conversationId,
      context(seller),
      { limit: 1, afterSequence: first.sequence },
    );
    expect(delta.items.map((message) => message.id)).toEqual([second.id]);
    expect(delta.hasMore).toBe(false);
    expect(
      await messages.findMessages(first.conversationId, context(seller), {
        limit: 1,
        afterSequence: second.sequence,
      }),
    ).toEqual({ items: [], nextCursor: null, hasMore: false });
    const older = await messages.findMessages(
      first.conversationId,
      context(seller),
      {
        limit: 1,
        before: page.nextCursor!,
      },
    );
    expect(older.items[0].images).toHaveLength(3);
    expect(older.hasMore).toBe(false);
    await expect(
      messages.findMessages(first.conversationId, context(seller), {
        before: uuidv7(),
        limit: 1,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("authorization precedes storage IO; missing/foreign objects fail without persisted changes", async () => {
    const first = await send("first");
    storage.headObject.mockClear();
    storage.presignGetMany.mockClear();
    await expect(
      messages.sendMessage(context(outsider), {
        conversationId: first.conversationId,
        images: [`messages/${outsider.id}/${uuidv7()}.png`],
        clientId: uuidv7(),
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(storage.headObject).not.toHaveBeenCalled();
    expect(storage.presignGetMany).not.toHaveBeenCalled();
    await expect(
      messages.findMessages(first.conversationId, context(outsider), {
        limit: 30,
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      notifications.markOneAsRead(
        context(outsider),
        (
          await ds
            .getRepository(NotificationEntity)
            .findOneByOrFail({ userId: seller.id })
        ).id,
      ),
    ).rejects.toMatchObject({ status: 404 });
    storage.headObject.mockResolvedValueOnce(null);
    await expect(
      messages.sendMessage(context(buyer), {
        postId: post.id,
        images: [`messages/${buyer.id}/${uuidv7()}.png`],
        clientId: uuidv7(),
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(await ds.getRepository(MessageEntity).count()).toBe(1);
  });

  it("self/hidden/deleted post cannot start a chat; existing participants can reply with historical public snapshots", async () => {
    await expect(
      messages.sendMessage(context(seller), {
        postId: post.id,
        content: "self",
        clientId: uuidv7(),
      }),
    ).rejects.toMatchObject({ status: 400 });
    await ds
      .getRepository(PostEntity)
      .update(post.id, { status: PostStatus.HIDDEN });
    await expect(send("hidden")).rejects.toMatchObject({ status: 404 });
    await ds
      .getRepository(PostEntity)
      .update(post.id, { status: PostStatus.ACTIVE });
    const first = await send("first");
    await ds.getRepository(PostImageEntity).save({
      id: uuidv7(),
      postId: post.id,
      url: "https://test.invalid/thumbnail.png",
    });
    await ds.getRepository(PostEntity).softDelete(post.id);
    await ds.getRepository(UserEntity).softDelete(buyer.id);
    await expect(send("deleted")).rejects.toMatchObject({ status: 404 });
    const reply = await messages.sendMessage(context(seller), {
      conversationId: first.conversationId,
      content: "still works",
      clientId: uuidv7(),
    });
    expect(reply.sequence).toBe("2");
    const sellerCtx: AuthenticatedContext = new AuthorizationService(
      new CaslAbilityFactory(),
    ).createAuthenticatedContext({
      id: seller.id,
      email: seller.email,
      fullName: seller.fullName,
      isAdmin: false,
    });
    const detail = await conversations.findOne(first.conversationId, sellerCtx);
    expect(detail).toMatchObject({
      role: "seller",
      counterpart: { id: buyer.id, fullName: buyer.fullName },
      post: {
        id: post.id,
        title: post.title,
        thumbnailUrl: "https://test.invalid/thumbnail.png",
      },
      unreadCount: 1,
    });
    expect(Object.keys(detail.counterpart).sort()).toEqual([
      "avatarUrl",
      "fullName",
      "id",
    ]);
  });

  it("history excludes new arrivals while paging, multi-image latest message occupies one slot and timestamps round-trip", async () => {
    const first = await send("first");
    const second = await send("second");
    const imageKeys = Array.from(
      { length: 5 },
      () => `messages/${buyer.id}/${uuidv7()}.png`,
    );
    const latest = await messages.sendMessage(context(buyer), {
      conversationId: first.conversationId,
      images: imageKeys,
      clientId: uuidv7(),
    });
    const page = await messages.findMessages(
      first.conversationId,
      context(seller),
      {
        limit: 2,
      },
    );
    expect(page.items.map((m) => m.id)).toEqual([latest.id, second.id]);
    expect(page.items[0].images).toHaveLength(5);
    expect(page.items[0].createdAt.getTime()).toBe(latest.createdAt.getTime());
    expect((await state(first.conversationId)).lastMessageAt!.getTime()).toBe(
      latest.createdAt.getTime(),
    );
    const [{ now }] = await ds.query(`SELECT clock_timestamp() AS now`);
    expect(
      Math.abs(latest.createdAt.getTime() - new Date(now).getTime()),
    ).toBeLessThan(10000);
    await send("new arrival");
    const older = await messages.findMessages(
      first.conversationId,
      context(seller),
      {
        limit: 2,
        before: page.nextCursor!,
      },
    );
    expect(older.items.map((m) => m.id)).toEqual([first.id]);
    expect(older.hasMore).toBe(false);
    expect(
      await messages.findMessages(first.conversationId, context(seller), {
        limit: 2,
        before: first.id,
      }),
    ).toEqual({ items: [], hasMore: false, nextCursor: null });
  });

  it("parallel image retries attach once and return one stable message", async () => {
    const image = `messages/${buyer.id}/${uuidv7()}.png`;
    const clientId = uuidv7();
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        messages.sendMessage(context(buyer), {
          postId: post.id,
          images: [image],
          clientId,
        }),
      ),
    );
    expect(new Set(results.map((m) => m.id)).size).toBe(1);
    expect(
      (await ds.query(`SELECT count(*)::int AS count FROM message_images`))[0]
        .count,
    ).toBe(1);
    expect((await state(results[0].conversationId)).stateVersion).toBe("1");
    expect(realtime.emitToConversation).toHaveBeenCalledTimes(1);
  });

  it("manual read-all locks multiple conversations consistently; notification list queries are batched", async () => {
    const category = await createTestCategory(ds);
    const posts = await Promise.all(
      Array.from({ length: 3 }, () =>
        createTestPost(ds, seller.id, category.id),
      ),
    );
    const first = await Promise.all(
      posts.map((target) =>
        messages.sendMessage(context(buyer), {
          postId: target.id,
          content: "first",
          clientId: uuidv7(),
        }),
      ),
    );
    const querySpy = jest.spyOn(ds.logger, "logQuery");
    const list = await notifications.getList(context(seller), {
      page: 1,
      limit: 10,
    });
    expect(list.snapshots).toHaveLength(3);
    expect(
      querySpy.mock.calls.filter(([query]) => /^SELECT/i.test(query)).length,
    ).toBeLessThanOrEqual(4);
    querySpy.mockRestore();
    await Promise.all([
      notifications.markAllAsRead(context(seller)),
      notifications.markAllAsRead(context(seller)),
      ...first.map((message) =>
        messages.sendMessage(context(buyer), {
          conversationId: message.conversationId,
          content: "concurrent",
          clientId: uuidv7(),
        }),
      ),
    ]);
    expect(await messages.getUnreadCount(context(seller))).toEqual({
      total: 6,
      conversations: 3,
    });
    for (const message of first) {
      expect((await state(message.conversationId)).lastMessageSequence).toBe(
        "2",
      );
      expect(
        await ds.getRepository(NotificationEntity).countBy({
          userId: seller.id,
          refId: message.conversationId,
          isRead: false,
        }),
      ).toBeLessThanOrEqual(1);
    }
  });
  it("established replay skips HEAD after soft delete and revoked participation denies before signing", async () => {
    const key = "messages/" + buyer.id + "/" + uuidv7() + ".png",
      clientId = uuidv7();
    const dto = { postId: post.id, images: [key], clientId, content: "replay" };
    const first = await messages.sendMessage(context(buyer), dto);
    await ds.getRepository(PostEntity).softDelete(post.id);
    storage.headObject.mockClear();
    storage.presignGetMany.mockClear();
    realtime.emitToConversation.mockClear();
    const replay = await messages.sendMessage(context(buyer), dto);
    expect(replay.id).toBe(first.id);
    expect(replay.sequence).toBe(first.sequence);
    expect(storage.headObject).not.toHaveBeenCalled();
    expect(realtime.emitToConversation).not.toHaveBeenCalled();
    expect(await ds.getRepository(MessageEntity).count()).toBe(1);
    await ds
      .getRepository(ConversationEntity)
      .update(first.conversationId, { buyerId: outsider.id });
    storage.presignGetMany.mockClear();
    await expect(
      messages.sendMessage(context(buyer), dto),
    ).rejects.toMatchObject({ status: 403 });
    expect(storage.presignGetMany).not.toHaveBeenCalled();
  });
});
