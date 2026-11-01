import { ForbiddenException } from "@nestjs/common";
import { PostingRestrictionEntity } from "../../src/modules/moderation/posting-restriction.entity";
import { UserWarningEntity } from "../../src/modules/moderation/user-warning.entity";
import { PostingRestrictionType } from "../../src/modules/moderation/posting-restriction.rules";
import { UserEntity } from "../../src/modules/user/user.entity";
import {
  HOUR,
  ModerationHarness,
  errorOf,
  httpBody,
} from "./moderation-harness";

const { TEMPORARY, PERMANENT } = PostingRestrictionType;

describe("posting restriction enforcement (real DB)", () => {
  let h: ModerationHarness;
  let admin: UserEntity;

  beforeAll(async () => {
    h = new ModerationHarness();
    await h.init();
    admin = await h.newUser(true);
  });

  afterAll(async () => {
    if (h) await h.dispose();
  });

  const restrict = (user: UserEntity, extra: Record<string, unknown> = {}) =>
    h.moderation.createPostingRestriction(h.ctx(admin), {
      userId: user.id,
      type: TEMPORARY,
      reason: "Đăng spam",
      expiresAt: new Date(Date.now() + HOUR),
      ...extra,
    });

  it("warning is recorded with actor/time but does not block posting", async () => {
    const user = await h.newUser();
    const warning = await h.moderation.issueWarning(h.ctx(admin), {
      userId: user.id,
      reason: "  Ngôn từ không phù hợp  ",
    });
    const stored = await h.ds
      .getRepository(UserWarningEntity)
      .findOneByOrFail({ id: warning.id });
    expect(stored).toMatchObject({
      userId: user.id,
      issuedById: admin.id,
      reason: "Ngôn từ không phù hợp",
      sourceReportId: null,
    });
    expect(stored.createdAt).toBeInstanceOf(Date);
    expect(await h.moderation.isPostingRestricted(user.id)).toBe(false);
    await expect(h.createPost(user)).resolves.toMatchObject({
      sellerId: user.id,
    });
  });

  it("temporary restriction blocks create with POSTING_RESTRICTED and writes nothing", async () => {
    const [user, bystander] = [await h.newUser(), await h.newUser()];
    const restriction = await restrict(user);
    const before = await h.postCount(user);

    const error = await errorOf(h.createPost(user));
    expect(error).toBeInstanceOf(ForbiddenException);
    expect(httpBody(error)).toEqual({
      statusCode: 403,
      code: "POSTING_RESTRICTED",
      message: "You are currently restricted from creating posts",
      restriction: {
        type: "TEMPORARY",
        reason: "Đăng spam",
        expiresAt: restriction.expiresAt!.toISOString(),
      },
    });
    expect(await h.postCount(user)).toBe(before);
    // Only this user is affected; account lock is untouched.
    await expect(h.createPost(bystander)).resolves.toBeDefined();
    expect((await h.reload(user)).isLocked).toBe(false);
  });

  it("expiry is evaluated on read: exact boundary and automatic re-enable", async () => {
    const user = await h.newUser();
    const restriction = await restrict(user, {
      expiresAt: new Date(Date.now() + 2 * HOUR),
    });
    const end = restriction.expiresAt!;
    const at = (ms: number) => ({ now: new Date(end.getTime() + ms) });
    expect(await h.moderation.isPostingRestricted(user.id, at(-1))).toBe(true);
    expect(await h.moderation.isPostingRestricted(user.id, at(0))).toBe(false);
    expect(await h.moderation.isPostingRestricted(user.id, at(1))).toBe(false);

    // A restriction whose window already passed no longer blocks posting.
    const expired = await h.newUser();
    const repo = h.ds.getRepository(PostingRestrictionEntity);
    // create() returns an entity instance so BaseEntity's @BeforeInsert sets id.
    await repo.save(
      repo.create({
        userId: expired.id,
        type: TEMPORARY,
        reason: "Đã hết hạn",
        startsAt: new Date(Date.now() - 3 * HOUR),
        expiresAt: new Date(Date.now() - HOUR),
        issuedById: admin.id,
      }),
    );
    await expect(h.createPost(expired)).resolves.toBeDefined();
    // History is kept as-is: no cron, no update, no delete.
    const rows = await h.ds
      .getRepository(PostingRestrictionEntity)
      .findBy({ userId: expired.id });
    expect(rows).toHaveLength(1);
    expect(rows[0].liftedAt).toBeNull();
  });

  it("permanent ban blocks until an admin lifts it", async () => {
    const [user, otherAdmin] = [await h.newUser(), await h.newUser(true)];
    const ban = await restrict(user, { type: PERMANENT, expiresAt: undefined });
    expect(ban.expiresAt).toBeNull();
    const far = { now: new Date(Date.now() + 50 * 365 * 24 * HOUR) };
    expect(await h.moderation.isPostingRestricted(user.id, far)).toBe(true);
    expect(httpBody(await errorOf(h.createPost(user)))).toMatchObject({
      code: "POSTING_RESTRICTED",
      restriction: { type: "PERMANENT", expiresAt: null },
    });

    const lifted = await h.moderation.liftPostingRestriction(
      h.ctx(otherAdmin),
      ban.id,
      "  Đã xác minh  ",
    );
    expect(lifted).toMatchObject({
      liftedById: otherAdmin.id,
      liftReason: "Đã xác minh",
      reason: "Đăng spam",
    });
    expect(lifted.liftedAt).toBeInstanceOf(Date);
    await expect(h.createPost(user)).resolves.toBeDefined();
    expect((await h.reload(user)).isLocked).toBe(false);
  });
});
