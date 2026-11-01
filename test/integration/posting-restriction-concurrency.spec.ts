import { ForbiddenException } from "@nestjs/common";
import type { QueryRunner } from "typeorm";
import { PostEntity, PostStatus } from "../../src/modules/posts/post.entity";
import { PostingRestrictionEntity } from "../../src/modules/moderation/posting-restriction.entity";
import { PostingRestrictionType } from "../../src/modules/moderation/posting-restriction.rules";
import { POSTING_ISOLATION } from "../../src/modules/moderation/moderation.service";
import { UserEntity } from "../../src/modules/user/user.entity";
import { HOUR, ModerationHarness, httpBody } from "./moderation-harness";
import { ownedTestSchema } from "./database";

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };
const settle = <T>(p: Promise<T>): Promise<Settled<T>> =>
  p.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );

/**
 * Deterministic ordering with real PostgreSQL connections:
 * 1. "holder" opens a READ COMMITTED transaction on its own connection and
 *    runs the first operation up to (not including) COMMIT.
 * 2. The competing operation starts on a different pooled connection.
 * 3. We poll pg_blocking_pids until that backend is provably waiting on the
 *    holder's pid (a state check, not a sleep), then COMMIT the holder.
 */
describe("posting restriction concurrency (real PostgreSQL locks)", () => {
  let h: ModerationHarness;
  let admin: UserEntity;
  const runners: QueryRunner[] = [];

  beforeAll(async () => {
    h = new ModerationHarness();
    await h.init();
    admin = await h.newUser(true);
  });

  afterEach(async () => {
    for (const runner of runners.splice(0)) {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
    }
  });

  afterAll(async () => {
    if (h) await h.dispose();
  });

  async function holder(): Promise<{ runner: QueryRunner; pid: number }> {
    const runner = h.ds.createQueryRunner();
    runners.push(runner);
    await runner.connect();
    await runner.startTransaction(POSTING_ISOLATION);
    const [{ pid }] = (await runner.query(
      "SELECT pg_backend_pid() AS pid",
    )) as Array<{ pid: number }>;
    const [{ level }] = (await runner.query(
      "SELECT current_setting('transaction_isolation') AS level",
    )) as Array<{ level: string }>;
    expect(level).toBe("read committed");
    return { runner, pid };
  }

  /** Resolves with the pid of a backend currently blocked by `holderPid`. */
  async function blockedBy(holderPid: number): Promise<number> {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const rows = (await h.ds.query(
        `SELECT pid FROM pg_stat_activity
          WHERE $1 = ANY (pg_blocking_pids(pid))`,
        [holderPid],
      )) as Array<{ pid: number }>;
      if (rows.length) return rows[0].pid;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`No backend became blocked by pid ${holderPid}`);
  }

  const restrictionInput = (user: UserEntity) => ({
    userId: user.id,
    type: PostingRestrictionType.TEMPORARY,
    reason: "Đăng spam",
    expiresAt: new Date(Date.now() + HOUR),
  });
  const restrictions = (user: UserEntity) =>
    h.ds.getRepository(PostingRestrictionEntity).findBy({ userId: user.id });
  const posts = (user: UserEntity) =>
    h.ds
      .getRepository(PostEntity)
      .find({ where: { sellerId: user.id }, withDeleted: true });
  async function deletedPost(user: UserEntity) {
    const post = await h.createPost(user);
    await h.posts.remove(post.id, h.ctx(user));
    return post.id;
  }

  it("create: restriction locks first → post waits, then gets 403 after commit", async () => {
    const user = await h.newUser();
    const { runner, pid } = await holder();
    await h.moderation.createPostingRestrictionWithManager(
      runner.manager,
      h.ctx(admin),
      restrictionInput(user),
    );

    const pending = settle(h.createPost(user));
    const waiter = await blockedBy(pid);
    expect(waiter).not.toBe(pid); // two distinct database connections
    expect(await posts(user)).toHaveLength(0);

    await runner.commitTransaction();
    const result = await pending;
    expect(result.ok).toBe(false);
    const error = (result as { error: unknown }).error;
    expect(error).toBeInstanceOf(ForbiddenException);
    expect(httpBody(error)).toMatchObject({ code: "POSTING_RESTRICTED" });
    expect(await posts(user)).toHaveLength(0);
  });

  it("create: post locks first → finishes before the restriction applies", async () => {
    const user = await h.newUser();
    const { runner, pid } = await holder();
    const created = await h.posts.createWithManager(
      runner.manager,
      h.postInput(),
      h.ctx(user),
    );

    const pending = settle(
      h.moderation.createPostingRestriction(
        h.ctx(admin),
        restrictionInput(user),
      ),
    );
    await blockedBy(pid);
    expect(await restrictions(user)).toHaveLength(0);

    const beforeCommit = new Date();
    await runner.commitTransaction();
    const result = await pending;
    expect(result.ok).toBe(true);
    const restriction = (result as { value: PostingRestrictionEntity }).value;
    // `now` was read after the user lock was granted, i.e. after our commit.
    expect(restriction.startsAt.getTime()).toBeGreaterThanOrEqual(
      beforeCommit.getTime(),
    );
    const stored = await posts(user);
    expect(stored.map((p) => [p.id, p.status, p.deletedAt])).toEqual([
      [created.id, PostStatus.ACTIVE, null],
    ]);
    // From now on the restriction is in force.
    await expect(h.createPost(user)).rejects.toThrow(ForbiddenException);
  });

  it("restore: restriction locks first → restore waits, then gets 403 after commit", async () => {
    const user = await h.newUser();
    const postId = await deletedPost(user);
    const { runner, pid } = await holder();
    await h.moderation.createPostingRestrictionWithManager(
      runner.manager,
      h.ctx(admin),
      restrictionInput(user),
    );

    const pending = settle(h.posts.restore(postId, h.ctx(user)));
    expect(await blockedBy(pid)).not.toBe(pid);

    await runner.commitTransaction();
    const result = await pending;
    expect(result.ok).toBe(false);
    expect(httpBody((result as { error: unknown }).error)).toMatchObject({
      code: "POSTING_RESTRICTED",
    });
    const [stored] = await posts(user);
    expect(stored.deletedAt).toBeInstanceOf(Date);
  });

  it("restore: restore locks first → finishes before the restriction applies", async () => {
    const user = await h.newUser();
    const postId = await deletedPost(user);
    const { runner, pid } = await holder();
    await h.posts.restoreWithManager(runner.manager, postId, h.ctx(user));

    const pending = settle(
      h.moderation.createPostingRestriction(
        h.ctx(admin),
        restrictionInput(user),
      ),
    );
    await blockedBy(pid);
    expect(await restrictions(user)).toHaveLength(0);

    await runner.commitTransaction();
    expect((await pending).ok).toBe(true);
    const [stored] = await posts(user);
    expect(stored.deletedAt).toBeNull();
    expect(await restrictions(user)).toHaveLength(1);
  });

  it("restore lock order is User → Post: it holds the user row while waiting on the post", async () => {
    const user = await h.newUser();
    const postId = await deletedPost(user);
    const schema = ownedTestSchema(h.ds);
    const { runner, pid } = await holder();
    await runner.query(
      `SELECT id FROM "${schema}"."posts" WHERE id = $1 FOR UPDATE`,
      [postId],
    );

    const pending = settle(h.posts.restore(postId, h.ctx(user)));
    await blockedBy(pid); // restore is now waiting on the post row

    // Third connection: the user row must already be locked by restore.
    const probe = h.ds.createQueryRunner();
    runners.push(probe);
    await probe.connect();
    await probe.startTransaction(POSTING_ISOLATION);
    await expect(
      probe.query(
        `SELECT id FROM "${schema}"."user" WHERE id = $1 FOR UPDATE NOWAIT`,
        [user.id],
      ),
    ).rejects.toMatchObject({ driverError: { code: "55P03" } });
    await probe.rollbackTransaction();

    await runner.rollbackTransaction();
    expect((await pending).ok).toBe(true);
    const [stored] = await posts(user);
    expect(stored.deletedAt).toBeNull();
  });
});
