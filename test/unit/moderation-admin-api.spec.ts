/**
 * MODULE: MODERATION & POSTING RESTRICTIONS
 *
 * WORD TEST CASES:
 * - TC-MAA-01: Chấp nhận: exactly 1000 characters, including Vietnamese text
 * - TC-MAA-02: Từ chối: 1001 characters
 * - TC-MAA-03: Từ chối: blank reason ""
 * - TC-MAA-04: Từ chối: blank reason " "
 * - TC-MAA-05: Từ chối: blank reason "   \t\n "
 * - TC-MAA-06: Áp dụng: the same rules to liftReason and restriction reason
 * - TC-MAA-07: Chấp nhận: 2026-12-01T10:00:00Z
 * - TC-MAA-08: Chấp nhận: 2026-12-01T10:00:00.123Z
 * - TC-MAA-09: Chấp nhận: 2026-12-01T17:00:00+07:00
 * - TC-MAA-10: Chấp nhận: 2026-12-01T05:00:00-05:00
 * - TC-MAA-11: Từ chối: 2026-12-01
 * - TC-MAA-12: Từ chối: 2026-12-01T10:00:00
 * - TC-MAA-13: Từ chối: 2026-12-01T10:00:00+0700
 * - TC-MAA-14: Từ chối: 2026-12-01 10:00:00Z
 * - TC-MAA-15: Từ chối: not-a-date
 * - TC-MAA-16: Sử dụng: >= for createdFrom and < for createdTo
 * - TC-MAA-17: Từ chối: equal instants with 400 before querying
 * - TC-MAA-18: Từ chối: equal across offsets with 400 before querying
 * - TC-MAA-19: Từ chối: from after to with 400 before querying
 * - TC-MAA-20: Response của warning không tiết lộ email hoặc password
 * - TC-MAA-21: Response restriction tóm tắt target, người tạo và người gỡ
 * - TC-MAA-22: Từ chối lift restriction EXPIRED với 400, không thay đổi history
 * - TC-MAA-23: Từ chối lift restriction đã LIFTED với thông báo sẵn có
 * - TC-MAA-24: Được gỡ (lift): ACTIVE
 * - TC-MAA-25: Được gỡ (lift): SCHEDULED
 * - TC-MAA-26: Được gỡ (lift): PERMANENT
 * - TC-MAA-27: Admin không thể tự gỡ (lift) restriction của chính mình
 * - TC-MAA-28: Admin đọc được bản ghi restriction của chính mình (D1)
 * - TC-MAA-29: User thường không đọc được bản ghi moderation
 */

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

  // [WORD-TC: TC-MAA-01]
  // Chức năng: Chấp nhận: exactly 1000 characters, including Vietnamese text
  it("[TC-MAA-01] Chấp nhận: exactly 1000 characters, including Vietnamese text", async () => {
    expect(await warning("a".repeat(1000))).toEqual([]);
    expect(await warning("Đ".repeat(1000))).toEqual([]);
  });

  // [WORD-TC: TC-MAA-02]
  // Chức năng: Từ chối: 1001 characters
  it("[TC-MAA-02] Từ chối: 1001 characters", async () => {
    expect(await warning("a".repeat(1001))).toEqual([
      expect.stringContaining("shorter than or equal to 1000"),
    ]);
  });

  // [WORD-TC: TC-MAA-03]
  // Chức năng: Từ chối: blank reason ""
  // [WORD-TC: TC-MAA-04]
  // Chức năng: Từ chối: blank reason " "
  // [WORD-TC: TC-MAA-05]
  // Chức năng: Từ chối: blank reason "   \t\n "
  it.each(["", " ", "   \t\n "])("[TC-MAA] Từ chối lý do cảnh báo để trống: %j", async (reason) => {
    expect(await warning(reason)).toContain("reason must not be blank");
  });

  // [WORD-TC: TC-MAA-06]
  // Chức năng: Áp dụng: the same rules to liftReason and restriction reason
  it("[TC-MAA-06] Áp dụng: the same rules to liftReason and restriction reason", async () => {
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

  // [WORD-TC: TC-MAA-07]
  // Chức năng: Chấp nhận: 2026-12-01T10:00:00Z
  // [WORD-TC: TC-MAA-08]
  // Chức năng: Chấp nhận: 2026-12-01T10:00:00.123Z
  // [WORD-TC: TC-MAA-09]
  // Chức năng: Chấp nhận: 2026-12-01T17:00:00+07:00
  // [WORD-TC: TC-MAA-10]
  // Chức năng: Chấp nhận: 2026-12-01T05:00:00-05:00
  it.each([
    "2026-12-01T10:00:00Z",
    "2026-12-01T10:00:00.123Z",
    "2026-12-01T17:00:00+07:00",
    "2026-12-01T05:00:00-05:00",
  ])("[TC-MAA] Chấp nhận định dạng mốc thời gian hợp lệ: %s", async (value) => {
    expect(await restrictionDto(value)).toEqual([]);
    expect(await errors(WarningListQueryDto, { createdFrom: value })).toEqual(
      [],
    );
  });

  // [WORD-TC: TC-MAA-11]
  // Chức năng: Từ chối: 2026-12-01
  // [WORD-TC: TC-MAA-12]
  // Chức năng: Từ chối: 2026-12-01T10:00:00
  // [WORD-TC: TC-MAA-13]
  // Chức năng: Từ chối: 2026-12-01T10:00:00+0700
  // [WORD-TC: TC-MAA-14]
  // Chức năng: Từ chối: 2026-12-01 10:00:00Z
  // [WORD-TC: TC-MAA-15]
  // Chức năng: Từ chối: not-a-date
  it.each([
    "2026-12-01",
    "2026-12-01T10:00:00",
    "2026-12-01T10:00:00+0700",
    "2026-12-01 10:00:00Z",
    "not-a-date",
  ])("[TC-MAA] Từ chối định dạng mốc thời gian không hợp lệ: %s", async (value) => {
    expect(await restrictionDto(value)).not.toEqual([]);
    expect(
      await errors(RestrictionListQueryDto, { createdTo: value }),
    ).not.toEqual([]);
  });
});

describe("D4: [createdFrom, createdTo) date range in the service", () => {
  const base = { page: 1, limit: 20 } as WarningListQueryDto;

  // [WORD-TC: TC-MAA-16]
  // Chức năng: Sử dụng: >= for createdFrom and < for createdTo
  it("[TC-MAA-16] Sử dụng: >= for createdFrom and < for createdTo", async () => {
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

  // [WORD-TC: TC-MAA-17]
  // Chức năng: Từ chối: equal instants with 400 before querying
  // [WORD-TC: TC-MAA-18]
  // Chức năng: Từ chối: equal across offsets with 400 before querying
  // [WORD-TC: TC-MAA-19]
  // Chức năng: Từ chối: from after to with 400 before querying
  it.each([
    ["equal instants", "2026-11-01T00:00:00Z", "2026-11-01T00:00:00Z"],
    [
      "equal across offsets",
      "2026-11-01T07:00:00+07:00",
      "2026-11-01T00:00:00Z",
    ],
    ["from after to", "2026-11-02T00:00:00Z", "2026-11-01T00:00:00Z"],
  ])("[TC-MAA] Từ chối khoảng thời gian không hợp lệ (%s) với mã 400 trước khi query", async (_label, from, to) => {
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

  // [WORD-TC: TC-MAA-20]
  // Chức năng: Response của warning không tiết lộ email hoặc password
  it("[TC-MAA-20] Response của warning không tiết lộ email hoặc password", () => {
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

  // [WORD-TC: TC-MAA-21]
  // Chức năng: Response restriction tóm tắt target, người tạo và người gỡ
  it("[TC-MAA-21] Response restriction tóm tắt target, người tạo và người gỡ", () => {
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

  // [WORD-TC: TC-MAA-22]
  // Chức năng: Từ chối lift restriction EXPIRED với 400, không thay đổi history
  it("[TC-MAA-22] Từ chối lift restriction EXPIRED với 400, không thay đổi history", async () => {
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

  // [WORD-TC: TC-MAA-23]
  // Chức năng: Từ chối lift restriction đã LIFTED với thông báo sẵn có
  it("[TC-MAA-23] Từ chối lift restriction đã LIFTED với thông báo sẵn có", async () => {
    const { service, update } = liftHarness(
      restriction({ liftedAt: new Date(), liftedById: OTHER_ADMIN }),
    );
    await expect(
      service.liftPostingRestriction(ctx(ADMIN), RESTRICTION, "ok"),
    ).rejects.toThrow("Posting restriction has already been lifted");
    expect(update).not.toHaveBeenCalled();
  });

  // [WORD-TC: TC-MAA-24]
  // Chức năng: Được gỡ (lift): ACTIVE
  // [WORD-TC: TC-MAA-25]
  // Chức năng: Được gỡ (lift): SCHEDULED
  // [WORD-TC: TC-MAA-26]
  // Chức năng: Được gỡ (lift): PERMANENT
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
  ])("[TC-MAA] Gỡ bỏ thành công hạn chế đăng tin trạng thái %s", async (_label, row) => {
    const { service, update } = liftHarness(row());
    await service.liftPostingRestriction(ctx(ADMIN), RESTRICTION, "  ok  ");
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ id: RESTRICTION }),
      expect.objectContaining({ liftedById: ADMIN, liftReason: "ok" }),
    );
  });

  // [WORD-TC: TC-MAA-27]
  // Chức năng: Admin không thể tự gỡ (lift) restriction của chính mình
  it("[TC-MAA-27] Admin không thể tự gỡ (lift) restriction của chính mình", async () => {
    const { service, update } = liftHarness(restriction({ userId: ADMIN }));
    await expect(
      service.liftPostingRestriction(ctx(ADMIN), RESTRICTION, "ok"),
    ).rejects.toThrow("You cannot moderate your own account");
    expect(update).not.toHaveBeenCalled();
  });

  // [WORD-TC: TC-MAA-28]
  // Chức năng: Admin đọc được bản ghi restriction của chính mình (D1)
  it("[TC-MAA-28] Admin đọc được bản ghi restriction của chính mình (D1)", async () => {
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

  // [WORD-TC: TC-MAA-29]
  // Chức năng: User thường không đọc được bản ghi moderation
  it("[TC-MAA-29] User thường không đọc được bản ghi moderation", async () => {
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
