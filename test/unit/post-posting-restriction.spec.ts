import "reflect-metadata";
import { ForbiddenException } from "@nestjs/common";
import type { DataSource, Repository } from "typeorm";
import { AuthorizationService } from "../../src/modules/authorization/authorization.service";
import { CaslAbilityFactory } from "../../src/modules/authorization/casl-ability.factory";
import { CategoryEntity } from "../../src/modules/categories/category.entity";
import {
  PostCondition,
  PostEntity,
  PostStatus,
} from "../../src/modules/posts/post.entity";
import { PostsService } from "../../src/modules/posts/posts.service";
import { StorageService } from "../../src/modules/storage/storage.service";
import {
  ModerationService,
  POSTING_ISOLATION,
} from "../../src/modules/moderation/moderation.service";
import {
  PostingRestrictionType,
  postingRestrictedException,
} from "../../src/modules/moderation/posting-restriction.rules";

const SELLER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const CATEGORY = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const POST = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const LOCKED_AT = new Date("2026-11-01T10:00:00.000Z");
const authorization = new AuthorizationService(new CaslAbilityFactory());
const body = {
  categoryId: CATEGORY,
  title: "Sách Giải tích",
  description: "Sách còn tốt, có ghi chú bằng bút chì.",
  price: "50000",
  condition: PostCondition.GOOD,
};
const restricted = postingRestrictedException({
  type: PostingRestrictionType.PERMANENT,
  reason: "Fraud",
  startsAt: new Date("2026-01-01T00:00:00Z"),
  expiresAt: null,
  liftedAt: null,
});

/** Records every lock/read/write in order so tests can assert lock order. */
function setup(options: {
  restricted: boolean;
  isAdmin?: boolean;
  actor?: string;
}) {
  const calls: string[] = [];
  const post = Object.assign(new PostEntity(), {
    ...body,
    id: POST,
    sellerId: SELLER,
    status: PostStatus.ACTIVE,
    location: null,
    deletedAt: new Date("2026-10-01T00:00:00Z"),
  });
  const query: Record<string, jest.Mock> = {};
  for (const method of ["where", "withDeleted"])
    query[method] = jest.fn().mockReturnValue(query);
  query.setLock = jest.fn((mode: string) => {
    calls.push(`lock:post:${mode}`);
    return query;
  });
  query.getOne = jest.fn(async () => post);
  const repo = {
    create: jest.fn((value) => Object.assign(new PostEntity(), value)),
    save: jest.fn(async (value) => {
      calls.push("save:post");
      return value;
    }),
    findOne: jest.fn(async () => ({ ...post })),
    createQueryBuilder: jest.fn().mockReturnValue(query),
    restore: jest.fn(async () => calls.push("restore:post")),
    findOneByOrFail: jest.fn().mockResolvedValue(post),
  };
  const categories = {
    findOneBy: jest.fn(async () => {
      calls.push("read:category");
      return { id: CATEGORY };
    }),
  };
  // Every repository comes from the transaction manager, never the defaults.
  const manager = {
    getRepository: (entity: unknown) =>
      entity === CategoryEntity ? categories : repo,
  };
  const transaction = jest.fn(
    async (isolation: string, fn: (m: unknown) => unknown) => {
      calls.push(`tx:${isolation}`);
      return fn(manager);
    },
  );
  const lockPostingUser = jest.fn(async (_m: unknown, userId: string) => {
    calls.push(`lock:user:${userId}`);
    return LOCKED_AT;
  });
  const assertCanPost = jest.fn(
    async (_m: unknown, userId: string, now: Date) => {
      calls.push(`check:${userId}@${now.toISOString()}`);
      if (options.restricted) throw restricted;
    },
  );
  const moderation = {
    lockPostingUser,
    assertCanPost,
    lockAndAssertCanPost: jest.fn(async (m: unknown, userId: string) =>
      assertCanPost(m, userId, await lockPostingUser(m, userId)),
    ),
  };
  const service = new PostsService(
    {} as Repository<PostEntity>,
    {} as Repository<CategoryEntity>,
    authorization,
    { transaction } as unknown as DataSource,
    {} as StorageService,
    moderation as unknown as ModerationService,
  );
  const context = authorization.createAuthenticatedContext({
    id: options.actor ?? SELLER,
    email: "seller@example.test",
    fullName: "Seller",
    isAdmin: options.isAdmin ?? false,
    hasLocation: true,
  });
  return { service, repo, categories, moderation, context, post, calls };
}

const checkedAtLock = `check:${SELLER}@${LOCKED_AT.toISOString()}`;

describe("PostsService posting restriction enforcement", () => {
  it("create: READ COMMITTED, user lock first, check at post-lock instant, then write", async () => {
    const { service, context, calls } = setup({ restricted: false });
    await service.create(body, context);
    expect(POSTING_ISOLATION).toBe("READ COMMITTED");
    expect(calls).toEqual([
      "tx:READ COMMITTED",
      `lock:user:${SELLER}`,
      checkedAtLock,
      "read:category",
      "save:post",
    ]);
  });

  it("restricted user gets POSTING_RESTRICTED and nothing is written", async () => {
    const { service, repo, categories, context } = setup({ restricted: true });
    const error = await service.create(body, context).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getResponse()).toMatchObject({
      code: "POSTING_RESTRICTED",
      restriction: { type: "PERMANENT", reason: "Fraud", expiresAt: null },
    });
    expect(repo.save).not.toHaveBeenCalled();
    expect(categories.findOneBy).not.toHaveBeenCalled();
  });

  it("admins are not exempt from posting restrictions", async () => {
    const { service, repo, context } = setup({
      restricted: true,
      isAdmin: true,
    });
    await expect(service.create(body, context)).rejects.toThrow(
      ForbiddenException,
    );
    expect(repo.save).not.toHaveBeenCalled();
  });

  it("restore: READ COMMITTED, lock order User → Post, check at post-lock instant", async () => {
    const { service, context, calls } = setup({ restricted: false });
    await service.restore(POST, context);
    expect(calls).toEqual([
      "tx:READ COMMITTED",
      `lock:user:${SELLER}`,
      "lock:post:pessimistic_write",
      checkedAtLock,
      "restore:post",
    ]);
  });

  it("restricted restore is rejected after both locks and nothing is restored", async () => {
    const { service, repo, context, calls } = setup({ restricted: true });
    await expect(service.restore(POST, context)).rejects.toThrow(
      ForbiddenException,
    );
    expect(calls).toEqual([
      "tx:READ COMMITTED",
      `lock:user:${SELLER}`,
      "lock:post:pessimistic_write",
      checkedAtLock,
    ]);
    expect(repo.restore).not.toHaveBeenCalled();
  });

  it("no-op restore and outsiders take no lock at all", async () => {
    const live = setup({ restricted: true });
    live.repo.findOne.mockResolvedValueOnce({
      ...live.post,
      deletedAt: null as unknown as Date,
    });
    await expect(
      live.service.restore(POST, live.context),
    ).resolves.toBeDefined();
    expect(live.calls).toEqual(["tx:READ COMMITTED"]);

    const outsider = setup({ restricted: false, actor: OTHER });
    await expect(
      outsider.service.restore(POST, outsider.context),
    ).rejects.toThrow(ForbiddenException);
    expect(outsider.calls).toEqual(["tx:READ COMMITTED"]);
  });
});
