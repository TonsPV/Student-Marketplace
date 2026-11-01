import { BadRequestException, NotFoundException } from "@nestjs/common";
import { randomUUID } from "crypto";
import {
  ReportEntity,
  ReportReason,
  ReportTargetType,
} from "../../src/modules/reports/report.entity";
import { PostingRestrictionEntity } from "../../src/modules/moderation/posting-restriction.entity";
import { PostingRestrictionType } from "../../src/modules/moderation/posting-restriction.rules";
import { UserEntity } from "../../src/modules/user/user.entity";
import { HOUR, ModerationHarness } from "./moderation-harness";
import { createTestPost } from "./fixtures";

const { TEMPORARY } = PostingRestrictionType;

describe("moderation history and source reports (real DB)", () => {
  let h: ModerationHarness;
  let admin: UserEntity;
  let reporter: UserEntity;

  beforeAll(async () => {
    h = new ModerationHarness();
    await h.init();
    admin = await h.newUser(true);
    reporter = await h.newUser();
  });

  afterAll(async () => {
    if (h) await h.dispose();
  });

  const report = (targetType: ReportTargetType, targetId: string) =>
    h.ds.getRepository(ReportEntity).save({
      reporterId: reporter.id,
      targetType,
      targetId,
      reason: ReportReason.SPAM,
      description: "Bài đăng spam nhiều lần",
    });

  const temporary = (userId: string, extra: Record<string, unknown> = {}) => ({
    userId,
    type: TEMPORARY,
    reason: "Đăng spam",
    expiresAt: new Date(Date.now() + HOUR),
    ...extra,
  });

  it("accepts a USER report or a POST report that concerns the target user", async () => {
    const user = await h.newUser();
    const post = await createTestPost(h.ds, user.id, h.category.id);
    const userReport = await report(ReportTargetType.USER, user.id);
    const postReport = await report(ReportTargetType.POST, post.id);

    const warning = await h.moderation.issueWarning(h.ctx(admin), {
      userId: user.id,
      reason: "Cảnh báo",
      sourceReportId: userReport.id,
    });
    expect(warning.sourceReportId).toBe(userReport.id);

    // A soft-deleted post still identifies its seller.
    await h.posts.remove(post.id, h.ctx(user));
    const restriction = await h.moderation.createPostingRestriction(
      h.ctx(admin),
      temporary(user.id, { sourceReportId: postReport.id }),
    );
    expect(restriction.sourceReportId).toBe(postReport.id);
  });

  it("rejects a report about someone else or a report that does not exist", async () => {
    const [user, other] = [await h.newUser(), await h.newUser()];
    const otherPost = await createTestPost(h.ds, other.id, h.category.id);
    const aboutOther = await report(ReportTargetType.USER, other.id);
    const aboutOtherPost = await report(ReportTargetType.POST, otherPost.id);

    for (const sourceReportId of [aboutOther.id, aboutOtherPost.id]) {
      await expect(
        h.moderation.issueWarning(h.ctx(admin), {
          userId: user.id,
          reason: "x",
          sourceReportId,
        }),
      ).rejects.toThrow("Report does not concern this user");
      await expect(
        h.moderation.createPostingRestriction(
          h.ctx(admin),
          temporary(user.id, { sourceReportId }),
        ),
      ).rejects.toThrow(BadRequestException);
    }
    await expect(
      h.moderation.issueWarning(h.ctx(admin), {
        userId: user.id,
        reason: "x",
        sourceReportId: randomUUID(),
      }),
    ).rejects.toThrow(NotFoundException);
    expect(
      await h.ds
        .getRepository(PostingRestrictionEntity)
        .countBy({ userId: user.id }),
    ).toBe(0);
  });

  it("rejects unknown target users and restrictions", async () => {
    await expect(
      h.moderation.issueWarning(h.ctx(admin), {
        userId: randomUUID(),
        reason: "x",
      }),
    ).rejects.toThrow("User not found");
    await expect(
      h.moderation.liftPostingRestriction(h.ctx(admin), randomUUID(), "ok"),
    ).rejects.toThrow("Posting restriction not found");
  });

  it("lift is single-use, keeps the first lift record, and is race-safe", async () => {
    const [user, adminA, adminB] = [
      await h.newUser(),
      await h.newUser(true),
      await h.newUser(true),
    ];
    const restriction = await h.moderation.createPostingRestriction(
      h.ctx(admin),
      temporary(user.id),
    );

    const results = await Promise.allSettled([
      h.moderation.liftPostingRestriction(h.ctx(adminA), restriction.id, "A"),
      h.moderation.liftPostingRestriction(h.ctx(adminB), restriction.id, "B"),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    );
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0].reason).toBeInstanceOf(BadRequestException);

    const stored = await h.ds
      .getRepository(PostingRestrictionEntity)
      .findOneByOrFail({ id: restriction.id });
    const winner = (ok[0] as PromiseFulfilledResult<PostingRestrictionEntity>)
      .value;
    expect(stored).toMatchObject({
      liftedById: winner.liftedById,
      liftReason: winner.liftReason,
      reason: "Đăng spam",
      issuedById: admin.id,
    });
    await expect(
      h.moderation.liftPostingRestriction(
        h.ctx(admin),
        restriction.id,
        "again",
      ),
    ).rejects.toThrow("already been lifted");
    expect(
      await h.ds
        .getRepository(PostingRestrictionEntity)
        .countBy({ userId: user.id }),
    ).toBe(1);
  });
});
