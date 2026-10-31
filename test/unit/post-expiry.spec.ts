import "reflect-metadata";
import { DataSource } from "typeorm";
import { PostExpiryService } from "../../src/modules/posts/post-expiry.service";
import { PostEntity, PostStatus } from "../../src/modules/posts/post.entity";
import { DAY_MS } from "../../src/modules/posts/post-lifecycle.constants";
import { NotificationType } from "../../src/modules/notifications/notification.entity";
import { NotificationsService } from "../../src/modules/notifications/notifications.service";

const NOW = new Date("2026-10-31T00:00:00Z");

function setup() {
  const posts = [
    Object.assign(new PostEntity(), {
      id: "expired",
      sellerId: "seller",
      title: "Old book",
      status: PostStatus.ACTIVE,
      expiresAt: new Date(NOW.getTime() - 1),
      renewalCount: 0,
    }),
    Object.assign(new PostEntity(), {
      id: "expiring",
      sellerId: "seller",
      title: "New book",
      status: PostStatus.ACTIVE,
      expiresAt: new Date(NOW.getTime() + 2 * DAY_MS),
      renewalCount: 1,
    }),
  ];
  const query: Record<string, jest.Mock> = {};
  for (const name of [
    "where",
    "andWhere",
    "orderBy",
    "addOrderBy",
    "take",
    "setLock",
    "setOnLocked",
  ])
    query[name] = jest.fn(() => query);
  query.getMany = jest.fn(async () => posts);
  const manager = {
    getRepository: () => ({ createQueryBuilder: () => query }),
    query: async () => [{ now: NOW }],
    update: jest.fn(async () => ({ affected: 1 })),
  };
  let committed = false;
  const ds = {
    transaction: async (work: (manager: unknown) => Promise<unknown>) => {
      const result = await work(manager);
      committed = true;
      return result;
    },
  } as DataSource;
  const notifications = {
    createOnce: jest.fn(async (_manager, input) => input),
    emitCreated: jest.fn(() => {
      expect(committed).toBe(true);
    }),
  };
  return {
    posts,
    query,
    manager,
    notifications,
    service: new PostExpiryService(
      ds,
      notifications as unknown as NotificationsService,
    ),
  };
}

describe("post expiry worker", () => {
  it("expires overdue posts and creates notifications with separate cycle keys, emitting only after commit", async () => {
    const state = setup();
    expect(await state.service.processBatch()).toEqual({
      processed: 2,
      expired: 1,
      notified: 2,
    });
    expect(state.manager.update).toHaveBeenCalledWith(PostEntity, "expired", {
      status: PostStatus.EXPIRED,
    });
    const inputs = state.notifications.createOnce.mock.calls.map(
      (call) => call[1],
    );
    expect(inputs).toEqual([
      expect.objectContaining({
        type: NotificationType.POST_EXPIRED,
        targetType: "my_post",
        dedupKey: "post:expired:cycle:0:expired",
      }),
      expect.objectContaining({
        type: NotificationType.POST_EXPIRING,
        dedupKey: "post:expiring:cycle:1:expiring",
      }),
    ]);
    expect(state.notifications.emitCreated).toHaveBeenCalledTimes(2);
  });

  it("does not emit duplicates ignored by the database", async () => {
    const state = setup();
    state.notifications.createOnce.mockResolvedValue(null);
    expect((await state.service.processBatch()).notified).toBe(0);
    expect(state.notifications.emitCreated).not.toHaveBeenCalled();
  });

  it("does not emit any events when the transaction fails", async () => {
    const state = setup();
    state.notifications.createOnce.mockRejectedValueOnce(
      new Error("database failure"),
    );
    await expect(state.service.processBatch()).rejects.toThrow(
      "database failure",
    );
    expect(state.notifications.emitCreated).not.toHaveBeenCalled();
  });

  it("sends expiry instead of a stale warning when the deadline passes while processing", async () => {
    const state = setup();
    state.posts.splice(1, 1);
    expect((await state.service.processBatch()).notified).toBe(1);
    expect(state.notifications.createOnce.mock.calls[0][1].type).toBe(
      NotificationType.POST_EXPIRED,
    );
  });
});
