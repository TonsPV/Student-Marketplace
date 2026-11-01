import "reflect-metadata";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import type { DataSource } from "typeorm";
import { AuthorizationService } from "../../src/modules/authorization/authorization.service";
import { CaslAbilityFactory } from "../../src/modules/authorization/casl-ability.factory";
import { ModerationService } from "../../src/modules/moderation/moderation.service";
import {
  CreateRestrictionDto,
  CreateWarningDto,
  LiftRestrictionDto,
  RestrictionListQueryDto,
  WarningListQueryDto,
} from "../../src/modules/moderation/dto/moderation.dto";
import {
  toRestrictionResponse,
  toWarningResponse,
} from "../../src/modules/moderation/moderation.mapper";
import { PostingRestrictionEntity } from "../../src/modules/moderation/posting-restriction.entity";
import { UserWarningEntity } from "../../src/modules/moderation/user-warning.entity";
import {
  PostingRestrictionType,
  RestrictionStatus,
} from "../../src/modules/moderation/posting-restriction.rules";
import { UserEntity } from "../../src/modules/user/user.entity";

const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_ADMIN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const RESTRICTION = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const HOUR = 3_600_000;

const authorization = new AuthorizationService(new CaslAbilityFactory());
const ctx = (id: string, isAdmin = true) =>
  authorization.createAuthenticatedContext({
    id,
    email: `${id}@example.test`,
    fullName: "Test",
    isAdmin,
    hasLocation: true,
  });

const user = (id: string, fullName: string) =>
  Object.assign(new UserEntity(), {
    id,
    fullName,
    email: `${id}@example.test`,
    password: "secret-hash",
  });

function restriction(
  overrides: Partial<PostingRestrictionEntity> = {},
): PostingRestrictionEntity {
  const now = Date.now();
  return Object.assign(new PostingRestrictionEntity(), {
    id: RESTRICTION,
    userId: USER,
    type: PostingRestrictionType.TEMPORARY,
    reason: "Spam",
    startsAt: new Date(now - HOUR),
    expiresAt: new Date(now + HOUR),
    issuedById: OTHER_ADMIN,
    sourceReportId: null,
    createdAt: new Date(now - HOUR),
    liftedAt: null,
    liftedById: null,
    liftReason: null,
    ...overrides,
  });
}

/** Chainable SelectQueryBuilder stub that records every call. */
function queryBuilder(result: { getOne?: unknown; many?: unknown[] } = {}) {
  const calls: Array<[string, unknown[]]> = [];
  const qb: Record<string, jest.Mock> = {};
  for (const method of [
    "withDeleted",
    "leftJoin",
    "addSelect",
    "where",
    "andWhere",
    "orderBy",
    "addOrderBy",
    "skip",
    "take",
    "setLock",
  ]) {
    qb[method] = jest.fn((...args: unknown[]) => {
      calls.push([method, args]);
      return qb;
    });
  }
  qb.getOne = jest.fn(async () => result.getOne ?? null);
  qb.getManyAndCount = jest.fn(async () => [
    result.many ?? [],
    (result.many ?? []).length,
  ]);
  return { qb, calls };
}

/** Read-only DataSource whose repositories all share one query builder. */
function readDataSource(qb: Record<string, jest.Mock>): DataSource {
  return {
    manager: { getRepository: () => ({ createQueryBuilder: () => qb }) },
  } as unknown as DataSource;
}

async function errors(cls: new () => object, plain: Record<string, unknown>) {
  const found = await validate(plainToInstance(cls, plain), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return found.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe("D3: reason / liftReason DTO validation", () => {
  const warning = (reason: unknown) =>
    errors(CreateWarningDto, { userId: USER, reason });

  it("accepts exactly 1000 characters, including Vietnamese text", async () => {
    expect(await warning("a".repeat(1000))).toEqual([]);
    expect(await warning("Đ".repeat(1000))).toEqual([]);
  });

  it("rejects 1001 characters", async () => {
    expect(await warning("a".repeat(1001))).toEqual([
      expect.stringContaining("shorter than or equal to 1000"),
    ]);
  });

  it.each(["", " ", "   \t\n "])("rejects blank reason %j", async (reason) => {
    expect(await warning(reason)).toContain("reason must not be blank");
  });

  it("applies the same rules to liftReason and restriction reason", async () => {
    expect(await errors(LiftRestrictionDto, { liftReason: "  " })).toContain(
      "liftReason must not be blank",
    );
    expect(
      await errors(LiftRestrictionDto, { liftReason: "x".repeat(1001) }),
    ).toHaveLength(1);
    expect(
      await errors(CreateRestrictionDto, {
        userId: USER,
        type: PostingRestrictionType.PERMANENT,
        reason: "x".repeat(1001),
      }),
    ).toHaveLength(1);
  });
});

describe("D4: instants must carry a timezone", () => {
  const restrictionDto = (expiresAt: unknown) =>
    errors(CreateRestrictionDto, {
      userId: USER,
      type: PostingRestrictionType.TEMPORARY,
      reason: "Spam",
      expiresAt,
    });

  it.each([
    "2026-12-01T10:00:00Z",
    "2026-12-01T10:00:00.123Z",
    "2026-12-01T17:00:00+07:00",
    "2026-12-01T05:00:00-05:00",
  ])("accepts %s", async (value) => {
    expect(await restrictionDto(value)).toEqual([]);
    expect(await errors(WarningListQueryDto, { createdFrom: value })).toEqual(
      [],
    );
  });

  it.each([
    "2026-12-01",
    "2026-12-01T10:00:00",
    "2026-12-01T10:00:00+0700",
    "2026-12-01 10:00:00Z",
    "not-a-date",
  ])("rejects %s", async (value) => {
    expect(await restrictionDto(value)).not.toEqual([]);
    expect(
      await errors(RestrictionListQueryDto, { createdTo: value }),
    ).not.toEqual([]);
  });
});

describe("D4: [createdFrom, createdTo) date range in the service", () => {
  const base = { page: 1, limit: 20 } as WarningListQueryDto;

  it("uses >= for createdFrom and < for createdTo", async () => {
    const { qb, calls } = queryBuilder();
    const service = new ModerationService(readDataSource(qb), authorization);
    await service.listWarnings(ctx(ADMIN), {
      ...base,
      createdFrom: "2026-11-01T00:00:00+07:00",
      createdTo: "2026-11-02T00:00:00Z",
    });
    const filters = calls.filter(([m]) => m === "andWhere").map(([, a]) => a);
    expect(filters).toEqual([
      [
        "warning.createdAt >= :createdFrom",
        { createdFrom: new Date("2026-10-31T17:00:00.000Z") },
      ],
      [
        "warning.createdAt < :createdTo",
        { createdTo: new Date("2026-11-02T00:00:00.000Z") },
      ],
    ]);
  });

  it.each([
    ["equal instants", "2026-11-01T00:00:00Z", "2026-11-01T00:00:00Z"],
    [
      "equal across offsets",
      "2026-11-01T07:00:00+07:00",
      "2026-11-01T00:00:00Z",
    ],
    ["from after to", "2026-11-02T00:00:00Z", "2026-11-01T00:00:00Z"],
  ])("rejects %s with 400 before querying", async (_label, from, to) => {
    const { qb } = queryBuilder();
    const service = new ModerationService(readDataSource(qb), authorization);
    const range = { ...base, createdFrom: from, createdTo: to };
    await expect(service.listWarnings(ctx(ADMIN), range)).rejects.toThrow(
      new BadRequestException("createdFrom must be earlier than createdTo"),
    );
    await expect(
      service.listRestrictions(ctx(ADMIN), range as RestrictionListQueryDto),
    ).rejects.toThrow(
      new BadRequestException("createdFrom must be earlier than createdTo"),
    );
    expect(qb.getManyAndCount).not.toHaveBeenCalled();
  });
});

describe("D5: user summaries expose only id and fullName", () => {
  const leaks = /email|password|example\.test/;

  it("warning response never leaks email or password", () => {
    const row = Object.assign(new UserWarningEntity(), {
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      userId: USER,
      user: user(USER, "Nguyễn Văn A"),
      reason: "Spam",
      sourceReportId: null,
      issuedById: ADMIN,
      issuedBy: user(ADMIN, "Admin"),
      createdAt: new Date("2026-11-01T00:00:00Z"),
    });
    const response = toWarningResponse(row);
    expect(response.user).toEqual({ id: USER, fullName: "Nguyễn Văn A" });
    expect(response.issuedBy).toEqual({ id: ADMIN, fullName: "Admin" });
    expect(JSON.stringify(response)).not.toMatch(leaks);
  });

  it("restriction response summarizes target, issuer and lifter", () => {
    const now = new Date();
    const lifted = toRestrictionResponse(
      restriction({
        user: user(USER, "Target"),
        issuedBy: user(OTHER_ADMIN, "Issuer"),
        liftedAt: now,
        liftedById: ADMIN,
        liftedBy: user(ADMIN, "Lifter"),
        liftReason: "ok",
      }),
      now,
    );
    expect(lifted.user).toEqual({ id: USER, fullName: "Target" });
    expect(lifted.issuedBy).toEqual({ id: OTHER_ADMIN, fullName: "Issuer" });
    expect(lifted.liftedBy).toEqual({ id: ADMIN, fullName: "Lifter" });
    expect(lifted.status).toBe(RestrictionStatus.LIFTED);
    expect(JSON.stringify(lifted)).not.toMatch(leaks);

    const active = toRestrictionResponse(restriction(), now);
    expect(active.liftedBy).toBeNull();
    expect(active.status).toBe(RestrictionStatus.ACTIVE);
  });
});

describe("D1 + D2: lift and read rules in the service", () => {
  function liftHarness(row: PostingRestrictionEntity) {
    const { qb } = queryBuilder({ getOne: row });
    const update = jest.fn(async () => ({ affected: 1 }));
    const findOneByOrFail = jest.fn(async () => row);
    const repo = { createQueryBuilder: () => qb, update, findOneByOrFail };
    const manager = { getRepository: () => repo };
    const transaction = jest.fn(
      async (_isolation: unknown, cb: (m: unknown) => Promise<unknown>) =>
        cb(manager),
    );
    const service = new ModerationService(
      { transaction, manager } as unknown as DataSource,
      authorization,
    );
    return { service, update };
  }

  it("rejects EXPIRED with 400 and leaves history untouched", async () => {
    const { service, update } = liftHarness(
      restriction({
        startsAt: new Date(Date.now() - 3 * HOUR),
        expiresAt: new Date(Date.now() - HOUR),
      }),
    );
    await expect(
      service.liftPostingRestriction(ctx(ADMIN), RESTRICTION, "ok"),
    ).rejects.toThrow(
      new BadRequestException("Posting restriction has already expired"),
    );
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects LIFTED with the existing message", async () => {
    const { service, update } = liftHarness(
      restriction({ liftedAt: new Date(), liftedById: OTHER_ADMIN }),
    );
    await expect(
      service.liftPostingRestriction(ctx(ADMIN), RESTRICTION, "ok"),
    ).rejects.toThrow("Posting restriction has already been lifted");
    expect(update).not.toHaveBeenCalled();
  });

  it.each([
    ["ACTIVE", () => restriction()],
    [
      "SCHEDULED",
      () =>
        restriction({
          startsAt: new Date(Date.now() + HOUR),
          expiresAt: new Date(Date.now() + 2 * HOUR),
        }),
    ],
    [
      "PERMANENT",
      () =>
        restriction({
          type: PostingRestrictionType.PERMANENT,
          expiresAt: null,
        }),
    ],
  ])("lifts %s", async (_label, row) => {
    const { service, update } = liftHarness(row());
    await service.liftPostingRestriction(ctx(ADMIN), RESTRICTION, "  ok  ");
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ id: RESTRICTION }),
      expect.objectContaining({ liftedById: ADMIN, liftReason: "ok" }),
    );
  });

  it("an admin cannot lift their own restriction", async () => {
    const { service, update } = liftHarness(restriction({ userId: ADMIN }));
    await expect(
      service.liftPostingRestriction(ctx(ADMIN), RESTRICTION, "ok"),
    ).rejects.toThrow("You cannot moderate your own account");
    expect(update).not.toHaveBeenCalled();
  });

  it("an admin can read their own restriction (D1)", async () => {
    const { qb } = queryBuilder({
      getOne: restriction({
        userId: ADMIN,
        user: user(ADMIN, "Admin"),
        issuedBy: user(OTHER_ADMIN, "Issuer"),
      }),
    });
    const service = new ModerationService(readDataSource(qb), authorization);
    const view = await service.getRestriction(ctx(ADMIN), RESTRICTION);
    expect(view.user).toEqual({ id: ADMIN, fullName: "Admin" });
    expect(view.status).toBe(RestrictionStatus.ACTIVE);
  });

  it("regular users cannot read moderation records", async () => {
    const service = new ModerationService({} as DataSource, authorization);
    await expect(
      service.getRestriction(ctx(USER, false), RESTRICTION),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      service.listWarnings(ctx(USER, false), {
        page: 1,
        limit: 20,
      } as WarningListQueryDto),
    ).rejects.toThrow(ForbiddenException);
  });
});
