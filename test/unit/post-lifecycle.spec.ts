import "reflect-metadata";
import { ConflictException, ForbiddenException } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { AuthorizationService } from "../../src/modules/authorization/authorization.service";
import { CaslAbilityFactory } from "../../src/modules/authorization/casl-ability.factory";
import { CategoryEntity } from "../../src/modules/categories/category.entity";
import {
  PostActivationPolicyService,
  PostingDecision,
} from "../../src/modules/posts/post-activation-policy.service";
import { PostLifecycleService } from "../../src/modules/posts/post-lifecycle.service";
import { DAY_MS } from "../../src/modules/posts/post-lifecycle.constants";
import {
  PostEntity,
  PostCondition,
  PostStatus,
} from "../../src/modules/posts/post.entity";
import { PostRenewalEntity } from "../../src/modules/posts/post-renewal.entity";
import { UserEntity } from "../../src/modules/user/user.entity";

const SELLER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const POST = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CATEGORY = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const NOW = new Date("2026-10-31T05:00:00Z");
const authorization = new AuthorizationService(new CaslAbilityFactory());
const context = authorization.createAuthenticatedContext({
  id: SELLER,
  email: "seller@example.test",
  fullName: "Seller",
  isAdmin: false,
  hasLocation: true,
});
const dto = {
  title: "Test book",
  description: "A book in good condition for students",
  categoryId: CATEGORY,
  price: "50000",
  condition: PostCondition.GOOD,
};

function setup(overrides: Partial<PostEntity> = {}) {
  const post = Object.assign(new PostEntity(), {
    id: POST,
    sellerId: SELLER,
    status: PostStatus.ACTIVE,
    deletedAt: null,
    soldAt: null,
    buyerId: null,
    publishedAt: new Date(NOW.getTime() - 15 * DAY_MS),
    expiresAt: new Date(NOW.getTime() - DAY_MS),
    renewalCount: 0,
    ...overrides,
  });
  const seller = { id: SELLER, isLocked: false };
  const chain = (result: unknown) => {
    const q: Record<string, jest.Mock> = {};
    for (const name of ["setLock", "where", "withDeleted"])
      q[name] = jest.fn(() => q);
    q.getOne = jest.fn(async () => result);
    q.getOneOrFail = jest.fn(async () => result);
    return q;
  };
  const posts = {
    countBy: jest.fn(async () => 0),
    create: jest.fn((input) =>
      Object.assign(new PostEntity(), { id: POST }, input),
    ),
    save: jest.fn(async (input) => input),
    createQueryBuilder: jest.fn(() => chain(post)),
    findOne: jest.fn(async () => post),
  };
  const history = {
    create: jest.fn((input) => input),
    save: jest.fn(async (input) => input),
    findOneBy: jest.fn<Promise<PostRenewalEntity | null>, [unknown]>(
      async () => null,
    ),
  };
  const manager = {
    queryRunner: { isTransactionActive: true },
    query: jest.fn(async (sql: string) =>
      sql === "SHOW transaction_isolation"
        ? [{ transaction_isolation: "read committed" }]
        : [{ now: NOW }],
    ),
    getRepository: jest.fn((entity) => {
      if (entity === UserEntity)
        return { createQueryBuilder: () => chain(seller) };
      if (entity === CategoryEntity)
        return { findOneBy: async () => ({ id: CATEGORY }) };
      if (entity === PostRenewalEntity) return history;
      return posts;
    }),
  } as unknown as EntityManager;
  const decision: PostingDecision = {
    allowed: true,
    reason: null,
    blockedUntil: null,
    limit: 5,
  };
  const restrictions = { evaluate: jest.fn(async () => decision) };
  const policy = new PostActivationPolicyService(restrictions);
  const ds = {
    transaction: async (
      _isolation: string,
      fn: (manager: EntityManager) => unknown,
    ) => fn(manager),
  } as DataSource;
  const service = new PostLifecycleService(ds, authorization, policy);
  return {
    service,
    post,
    posts,
    history,
    seller,
    manager,
    decision,
    restrictions,
  };
}

describe("post lifecycle", () => {
  it("creates a 14-day listing and reports remaining quota", async () => {
    const { service, posts } = setup();
    posts.countBy.mockResolvedValue(4);
    expect(await service.quota(context)).toMatchObject({
      used: 4,
      remaining: 1,
      limit: 5,
      canActivate: true,
      lifetimeDays: 14,
      reminderDays: 3,
    });
    const result = await service.create(dto, context);
    expect(result).toMatchObject({
      publishedAt: NOW,
      expiresAt: new Date(NOW.getTime() + 14 * DAY_MS),
      renewalCount: 0,
      status: PostStatus.ACTIVE,
    });
  });

  it("rejects a sixth listing", async () => {
    const { service, posts } = setup();
    posts.countBy.mockResolvedValue(5);
    await expect(service.create(dto, context)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(posts.save).not.toHaveBeenCalled();
    expect(await service.quota(context)).toMatchObject({
      remaining: 0,
      canActivate: false,
    });
  });

  it.each(["create", "restore", "renew"])(
    "applies Tấn's posting restriction to %s",
    async (operation) => {
      const state = setup({
        deletedAt: operation === "restore" ? NOW : null,
        expiresAt:
          operation === "restore"
            ? new Date(NOW.getTime() + DAY_MS)
            : new Date(NOW.getTime() - DAY_MS),
      });
      Object.assign(state.decision, {
        allowed: false,
        reason: "Repeated violations",
        blockedUntil: new Date(NOW.getTime() + DAY_MS),
      });
      const result =
        operation === "create"
          ? state.service.create(dto, context)
          : operation === "restore"
            ? state.service.restore(POST, context)
            : state.service.renewFree(POST, context);
      await expect(result).rejects.toMatchObject({
        response: { code: "POSTING_RESTRICTED", reason: "Repeated violations" },
      });
      expect(state.posts.save).not.toHaveBeenCalled();
    },
  );

  it("accepts reduced quota without treating posting restrictions as account locks", async () => {
    const state = setup();
    state.decision.limit = 2;
    state.posts.countBy.mockResolvedValue(2);
    await expect(state.service.create(dto, context)).rejects.toMatchObject({
      response: { code: "POST_QUOTA_EXCEEDED", limit: 2 },
    });
    expect(state.seller.isLocked).toBe(false);
  });

  it("restores an overdue listing as expired without consuming quota or resetting its free renewal", async () => {
    const state = setup({ deletedAt: NOW });
    const oldExpiry = state.post.expiresAt;
    state.decision.allowed = false;
    state.posts.countBy.mockResolvedValue(5);
    const result = await state.service.restore(POST, context);
    expect(result).toMatchObject({
      deletedAt: null,
      status: PostStatus.EXPIRED,
      expiresAt: oldExpiry,
      renewalCount: 0,
    });
    expect(state.restrictions.evaluate).not.toHaveBeenCalled();
  });

  it("does not reset expiry when restoring a listing that is still live", async () => {
    const expiresAt = new Date(NOW.getTime() + DAY_MS);
    const state = setup({ deletedAt: NOW, expiresAt, renewalCount: 1 });
    expect(await state.service.restore(POST, context)).toMatchObject({
      expiresAt,
      renewalCount: 1,
      deletedAt: null,
    });
  });

  it("checks quota when restoring a live listing", async () => {
    const state = setup({
      deletedAt: NOW,
      expiresAt: new Date(NOW.getTime() + DAY_MS),
    });
    state.posts.countBy.mockResolvedValue(5);
    await expect(state.service.restore(POST, context)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(state.posts.save).not.toHaveBeenCalled();
  });

  it("renews an expired listing for free exactly once, recording the old deadline", async () => {
    const state = setup();
    const previousExpiresAt = state.post.expiresAt;
    const result = await state.service.renewFree(POST, context);
    expect(result).toMatchObject({
      status: PostStatus.ACTIVE,
      renewalCount: 1,
      publishedAt: NOW,
      expiresAt: new Date(NOW.getTime() + 14 * DAY_MS),
    });
    expect(state.history.save).toHaveBeenCalledWith(
      expect.objectContaining({
        postId: POST,
        renewalNumber: 1,
        kind: "free",
        previousExpiresAt,
      }),
    );
    state.post.expiresAt = new Date(NOW.getTime() - DAY_MS);
    await expect(state.service.renewFree(POST, context)).rejects.toMatchObject({
      response: { code: "POST_PAYMENT_REQUIRED" },
    });
    expect(state.history.save).toHaveBeenCalledTimes(1);
  });

  it("cannot renew before expiry, including an immediate duplicate free request", async () => {
    const state = setup({ expiresAt: new Date(NOW.getTime() + DAY_MS) });
    await expect(state.service.renewFree(POST, context)).rejects.toMatchObject({
      response: { code: "POST_NOT_EXPIRED" },
    });
    expect(state.posts.save).not.toHaveBeenCalled();
  });

  it.each([PostStatus.SOLD, PostStatus.HIDDEN])(
    "cannot renew a %s listing",
    async (status) => {
      const state = setup({ status });
      await expect(
        state.service.renewFree(POST, context),
      ).rejects.toMatchObject({ response: { code: "POST_NOT_RENEWABLE" } });
    },
  );

  it("cannot renew another seller's listing", async () => {
    const state = setup({ sellerId: CATEGORY });
    await expect(state.service.renewFree(POST, context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(state.posts.save).not.toHaveBeenCalled();
  });

  it("checks quota for paid renewal as well as free renewal", async () => {
    const state = setup({ renewalCount: 1 });
    state.posts.countBy.mockResolvedValue(5);
    await expect(
      state.service.renewPaidWithManager(
        state.manager,
        POST,
        context,
        "verified-payment",
      ),
    ).rejects.toMatchObject({ response: { code: "POST_QUOTA_EXCEEDED" } });
  });

  it("does not renew a second time for a duplicate payment, even after the next expiry", async () => {
    const state = setup({ renewalCount: 2 });
    const before = state.post.expiresAt;
    state.history.findOneBy.mockResolvedValue(
      Object.assign(new PostRenewalEntity(), {
        postId: POST,
        paymentReference: "payment-1",
      }),
    );
    expect(
      await state.service.renewPaidWithManager(
        state.manager,
        POST,
        context,
        "payment-1",
      ),
    ).toBe(state.post);
    expect(state.post.expiresAt).toEqual(before);
    expect(state.posts.save).not.toHaveBeenCalled();
  });

  it("rejects a payment used on a different listing and paid renewal outside a transaction", async () => {
    const state = setup({ renewalCount: 1 });
    state.history.findOneBy.mockResolvedValue(
      Object.assign(new PostRenewalEntity(), { postId: CATEGORY }),
    );
    await expect(
      state.service.renewPaidWithManager(
        state.manager,
        POST,
        context,
        "payment-1",
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      state.service.renewPaidWithManager(
        {} as EntityManager,
        POST,
        context,
        "payment-1",
      ),
    ).rejects.toThrow("active transaction");
  });

  it("rejects repeatable-read payment transactions that could count an old quota snapshot", async () => {
    const state = setup({ renewalCount: 1 });
    jest
      .spyOn(state.manager, "query")
      .mockResolvedValue([{ transaction_isolation: "repeatable read" }]);
    await expect(
      state.service.renewPaidWithManager(
        state.manager,
        POST,
        context,
        "payment-1",
      ),
    ).rejects.toThrow("READ COMMITTED");
    expect(state.posts.save).not.toHaveBeenCalled();
  });
});
