import { ForbiddenException } from "@nestjs/common";
import { PostEntity } from "../../src/modules/posts/post.entity";
import { PostingRestrictionType } from "../../src/modules/moderation/posting-restriction.rules";
import { UserEntity } from "../../src/modules/user/user.entity";
import {
  HOUR,
  ModerationHarness,
  errorOf,
  httpBody,
} from "./moderation-harness";

const { TEMPORARY, PERMANENT } = PostingRestrictionType;

describe("posting restriction lifecycle (real DB)", () => {
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

  it("any active restriction blocks; lifting one keeps the others", async () => {
    const user = await h.newUser();
    const short = await restrict(user);
    const ban = await restrict(user, {
      type: PERMANENT,
      expiresAt: null,
      reason: "Lừa đảo",
    });
    expect(httpBody(await errorOf(h.createPost(user)))).toMatchObject({
      restriction: { type: "PERMANENT", reason: "Lừa đảo" },
    });

    await h.moderation.liftPostingRestriction(
      h.ctx(admin),
      ban.id,
      "Kháng cáo",
    );
    expect(httpBody(await errorOf(h.createPost(user)))).toMatchObject({
      restriction: { type: "TEMPORARY", reason: "Đăng spam" },
    });
    const active = await h.moderation.getActivePostingRestrictions(user.id);
    expect(active.map((r) => r.id)).toEqual([short.id]);
  });

  it("future startsAt schedules the restriction", async () => {
    const user = await h.newUser();
    const startsAt = new Date(Date.now() + HOUR);
    await restrict(user, {
      startsAt,
      expiresAt: new Date(startsAt.getTime() + HOUR),
    });
    await expect(h.createPost(user)).resolves.toBeDefined();
    expect(
      await h.moderation.isPostingRestricted(user.id, { now: startsAt }),
    ).toBe(true);
  });

  it("restricted admins are not exempt and cannot restrict themselves", async () => {
    const restrictedAdmin = await h.newUser(true);
    await restrict(restrictedAdmin);
    await expect(h.createPost(restrictedAdmin)).rejects.toThrow(
      ForbiddenException,
    );
    await expect(
      h.moderation.createPostingRestriction(h.ctx(admin), {
        userId: admin.id,
        type: PERMANENT,
        reason: "self",
      }),
    ).rejects.toThrow("You cannot moderate your own account");
  });

  it("restoring a deleted post is blocked while restricted", async () => {
    const user = await h.newUser();
    const post = await h.createPost(user);
    await h.posts.remove(post.id, h.ctx(user));
    const restriction = await restrict(user);
    const stored = () =>
      h.ds
        .getRepository(PostEntity)
        .findOneOrFail({ where: { id: post.id }, withDeleted: true });

    expect(
      httpBody(await errorOf(h.posts.restore(post.id, h.ctx(user)))),
    ).toMatchObject({ code: "POSTING_RESTRICTED" });
    expect((await stored()).deletedAt).toBeInstanceOf(Date);

    await h.moderation.liftPostingRestriction(
      h.ctx(admin),
      restriction.id,
      "ok",
    );
    await h.posts.restore(post.id, h.ctx(user));
    expect((await stored()).deletedAt).toBeNull();
  });
});
