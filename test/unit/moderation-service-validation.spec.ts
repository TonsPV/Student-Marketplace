import "reflect-metadata";
import { readFileSync } from "fs";
import { join } from "path";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type { DataSource } from "typeorm";
import { AuthorizationService } from "../../src/modules/authorization/authorization.service";
import { CaslAbilityFactory } from "../../src/modules/authorization/casl-ability.factory";
import { ModerationService } from "../../src/modules/moderation/moderation.service";
import { PostingRestrictionType } from "../../src/modules/moderation/posting-restriction.rules";

const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const RESTRICTION = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const LATER = new Date("2026-11-02T10:00:00.000Z");

const authorization = new AuthorizationService(new CaslAbilityFactory());
const ctx = (id: string, isAdmin: boolean) =>
  authorization.createAuthenticatedContext({
    id,
    email: `${id}@example.test`,
    fullName: "Test",
    isAdmin,
    hasLocation: true,
  });

describe("ModerationService input validation (rejected before DB access)", () => {
  const transaction = jest.fn(() => {
    throw new Error("DB must not be reached");
  });
  const service = new ModerationService(
    { transaction } as unknown as DataSource,
    authorization,
  );
  const admin = ctx(ADMIN, true);
  const temporary = {
    userId: USER,
    type: PostingRestrictionType.TEMPORARY,
    reason: "Spam",
    expiresAt: LATER,
  };
  afterAll(() => expect(transaction).not.toHaveBeenCalled());

  it("rejects non-admin actors for every moderation action", async () => {
    const user = ctx(USER, false);
    await expect(
      service.issueWarning(user, { userId: OTHER, reason: "x" }),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      service.createPostingRestriction(user, { ...temporary, userId: OTHER }),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      service.liftPostingRestriction(user, RESTRICTION, "ok"),
    ).rejects.toThrow(ForbiddenException);
  });

  it("rejects self-moderation, case-insensitively", async () => {
    await expect(
      service.issueWarning(admin, { userId: ADMIN, reason: "x" }),
    ).rejects.toThrow("You cannot moderate your own account");
    await expect(
      service.createPostingRestriction(admin, {
        ...temporary,
        userId: ADMIN.toUpperCase(),
      }),
    ).rejects.toThrow("You cannot moderate your own account");
  });

  it("requires a non-blank reason and lift reason", async () => {
    await expect(
      service.issueWarning(admin, { userId: USER, reason: "   " }),
    ).rejects.toThrow("reason is required");
    await expect(
      service.createPostingRestriction(admin, { ...temporary, reason: "" }),
    ).rejects.toThrow("reason is required");
    await expect(
      service.liftPostingRestriction(admin, RESTRICTION, " "),
    ).rejects.toThrow("liftReason is required");
  });

  it("D3: caps reason and lift reason at 1000 characters (after trim)", async () => {
    const long = "a".repeat(1001);
    await expect(
      service.issueWarning(admin, { userId: USER, reason: long }),
    ).rejects.toThrow("reason must be at most 1000 characters");
    await expect(
      service.createPostingRestriction(admin, { ...temporary, reason: long }),
    ).rejects.toThrow("reason must be at most 1000 characters");
    await expect(
      service.liftPostingRestriction(admin, RESTRICTION, long),
    ).rejects.toThrow("liftReason must be at most 1000 characters");
  });

  it("does not accept a client-supplied actor or unknown fields", async () => {
    await expect(
      service.issueWarning(admin, {
        userId: USER,
        reason: "x",
        issuedById: OTHER,
      } as never),
    ).rejects.toThrow("Unknown moderation field: issuedById");
    await expect(
      service.createPostingRestriction(admin, {
        ...temporary,
        liftedAt: null,
      } as never),
    ).rejects.toThrow("Unknown moderation field: liftedAt");
  });

  it("validates ids and the restriction window", async () => {
    await expect(
      service.issueWarning(admin, { userId: "not-a-uuid", reason: "x" }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.issueWarning(admin, {
        userId: USER,
        reason: "x",
        sourceReportId: "nope",
      }),
    ).rejects.toThrow("sourceReportId must be a UUID");
    await expect(
      service.createPostingRestriction(admin, {
        ...temporary,
        expiresAt: null,
      }),
    ).rejects.toThrow("requires a valid expiresAt");
    await expect(
      service.createPostingRestriction(admin, {
        ...temporary,
        type: PostingRestrictionType.PERMANENT,
      }),
    ).rejects.toThrow("must not have expiresAt");
    await expect(
      service.liftPostingRestriction(admin, "bad-id", "ok"),
    ).rejects.toThrow("restrictionId must be a UUID");
  });

  it("source never touches account lock, sessions, tokens or deletes", () => {
    const source = readFileSync(
      join(__dirname, "../../src/modules/moderation/moderation.service.ts"),
      "utf8",
    )
      // Ignore comments; only executable code matters here.
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    for (const forbidden of [
      "isLocked",
      "is_locked",
      "RefreshToken",
      "SessionRegistry",
      "AccountLifecycle",
      ".delete(",
      ".remove(",
      "softDelete",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
