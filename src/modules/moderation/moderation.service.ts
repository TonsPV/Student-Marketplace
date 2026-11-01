import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  DataSource,
  EntityManager,
  IsNull,
  type ObjectLiteral,
  type SelectQueryBuilder,
} from "typeorm";
import { isUUID } from "class-validator";
import { AuthorizationService } from "../authorization/authorization.service";
import type { AuthenticatedContext } from "../authorization/authorization.types";
import { createPaginationMeta } from "../../common/utils/pagination.util";
import { UserEntity } from "../user/user.entity";
import { PostEntity } from "../posts/post.entity";
import { ReportEntity, ReportTargetType } from "../reports/report.entity";
import { UserWarningEntity } from "./user-warning.entity";
import { PostingRestrictionEntity } from "./posting-restriction.entity";
import {
  PostingRestrictionType,
  RestrictionStatus,
  assertRestrictionShape,
  assertValidRestrictionWindow,
  isRestrictionActive,
  mostSevereRestriction,
  postingRestrictedException,
  restrictionStatus,
  restrictionStatusSql,
} from "./posting-restriction.rules";
import type {
  CreateRestrictionDto,
  CreateWarningDto,
  ModerationHistoryQueryDto,
  RestrictionListQueryDto,
  WarningListQueryDto,
} from "./dto/moderation.dto";
import { MODERATION_REASON_MAX } from "./dto/moderation.dto";
import type {
  Paginated,
  RestrictionResponse,
  WarningResponse,
} from "./dto/moderation-response.dto";
import type {
  UserModerationStatusResponse,
  UserRestrictionPageResponse,
  UserRestrictionResponse,
} from "./dto/user-moderation-response.dto";
import { toRestrictionResponse, toWarningResponse } from "./moderation.mapper";

export interface IssueWarningInput {
  userId: string;
  reason: string;
  sourceReportId?: string | null;
}

export interface CreatePostingRestrictionInput {
  userId: string;
  type: PostingRestrictionType;
  reason: string;
  /** Defaults to now. A future value schedules the restriction. */
  startsAt?: Date | null;
  /** Required for TEMPORARY, must be null/omitted for PERMANENT. */
  expiresAt?: Date | null;
  sourceReportId?: string | null;
}

export interface PostingCheckOptions {
  now?: Date;
  /** Run inside the caller's transaction (e.g. post restore). */
  manager?: EntityManager;
}

/**
 * Declared explicitly (PostgreSQL default, but not assumed). Required for
 * correctness: after waiting on the user row lock, the next statement takes
 * a fresh snapshot and sees what the lock holder committed. REPEATABLE READ
 * would keep the pre-wait snapshot and miss a just-committed restriction.
 */
export const POSTING_ISOLATION = "READ COMMITTED" as const;

const WARNING_FIELDS = new Set(["userId", "reason", "sourceReportId"]);
const RESTRICTION_FIELDS = new Set([
  "userId",
  "type",
  "reason",
  "startsAt",
  "expiresAt",
  "sourceReportId",
]);

/**
 * Warnings and posting restrictions. Deliberately independent from account
 * lock: nothing here reads or writes `user.is_locked`, refresh tokens or
 * sessions. The actor is always taken from the server-issued context.
 */
@Injectable()
export class ModerationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly authorization: AuthorizationService,
  ) {}

  async issueWarning(
    context: AuthenticatedContext,
    input: IssueWarningInput,
  ): Promise<UserWarningEntity> {
    this.assertKnownFields(input, WARNING_FIELDS);
    this.authorization.assertRoute(context, "create", "UserWarning");
    const userId = this.uuid(input.userId, "userId");
    const reason = this.reason(input.reason, "reason");
    const sourceReportId = this.optionalUuid(
      input.sourceReportId,
      "sourceReportId",
    );
    this.assertNotSelf(context, userId);
    this.authorization.assertCreate(context, "UserWarning", { userId });

    return this.dataSource.transaction(async (manager) => {
      await this.ensureTargetUser(manager, userId);
      if (sourceReportId) {
        await this.ensureReportConcernsUser(manager, sourceReportId, userId);
      }
      const repo = manager.getRepository(UserWarningEntity);
      return repo.save(
        repo.create({
          userId,
          reason,
          issuedById: context.principal.id,
          sourceReportId,
        }),
      );
    });
  }

  async createPostingRestriction(
    context: AuthenticatedContext,
    input: CreatePostingRestrictionInput,
  ): Promise<PostingRestrictionEntity> {
    // Malformed or unauthorized input is rejected before any row is locked.
    this.parseRestrictionInput(context, input);
    return this.dataSource.transaction(POSTING_ISOLATION, (manager) =>
      this.createPostingRestrictionWithManager(manager, context, input),
    );
  }

  /**
   * Runs inside the caller's READ COMMITTED transaction. Locks the target
   * user row first (same lock as post create/restore), then reads `now`, so
   * a concurrent post transaction is ordered strictly before or after this.
   */
  async createPostingRestrictionWithManager(
    manager: EntityManager,
    context: AuthenticatedContext,
    input: CreatePostingRestrictionInput,
  ): Promise<PostingRestrictionEntity> {
    const parsed = this.parseRestrictionInput(context, input);
    const now = await this.lockPostingUser(manager, parsed.userId);
    const window = assertValidRestrictionWindow(
      input.type,
      input.startsAt ?? now,
      input.expiresAt,
      now,
    );
    if (parsed.sourceReportId) {
      await this.ensureReportConcernsUser(
        manager,
        parsed.sourceReportId,
        parsed.userId,
      );
    }
    const repo = manager.getRepository(PostingRestrictionEntity);
    // Existing restrictions are kept; any active one blocks posting.
    return repo.save(
      repo.create({
        userId: parsed.userId,
        type: window.type,
        reason: parsed.reason,
        startsAt: window.startsAt,
        expiresAt: window.expiresAt,
        issuedById: context.principal.id,
        sourceReportId: parsed.sourceReportId,
        liftedAt: null,
        liftedById: null,
        liftReason: null,
      }),
    );
  }

  /** Lifts exactly one restriction; history and other restrictions stay. */
  async liftPostingRestriction(
    context: AuthenticatedContext,
    restrictionId: string,
    liftReason: string,
  ): Promise<PostingRestrictionEntity> {
    this.authorization.assertRoute(context, "lift", "PostingRestriction");
    const id = this.uuid(restrictionId, "restrictionId");
    const reason = this.reason(liftReason, "liftReason");

    return this.dataSource.transaction(POSTING_ISOLATION, async (manager) => {
      const repo = manager.getRepository(PostingRestrictionEntity);
      const restriction = await repo
        .createQueryBuilder("restriction")
        .setLock("pessimistic_write")
        .where("restriction.id = :id", { id })
        .getOne();
      if (!restriction) {
        throw new NotFoundException("Posting restriction not found");
      }
      this.assertNotSelf(context, restriction.userId);
      this.authorization.assertResource(context, "lift", "PostingRestriction", {
        id: restriction.id,
        userId: restriction.userId,
      });
      if (restriction.liftedAt) {
        throw new BadRequestException(
          "Posting restriction has already been lifted",
        );
      }
      // Clock read after the row lock, like every other posting operation.
      const now = new Date();
      // D2: an EXPIRED record keeps its history; ACTIVE/SCHEDULED may lift.
      if (restrictionStatus(restriction, now) === RestrictionStatus.EXPIRED) {
        throw new BadRequestException(
          "Posting restriction has already expired",
        );
      }
      await repo.update(
        { id, liftedAt: IsNull() },
        { liftedAt: now, liftedById: context.principal.id, liftReason: reason },
      );
      return repo.findOneByOrFail({ id });
    });
  }

  // ---- Admin read API (Phase 2) -------------------------------------------

  async listWarnings(
    context: AuthenticatedContext,
    query: WarningListQueryDto,
  ): Promise<Paginated<WarningResponse>> {
    this.authorization.assertRoute(context, "read", "UserWarning");
    const qb = this.warningQuery();
    this.applyCommonFilters(qb, "warning", query);
    return this.page(qb, "warning", query, toWarningResponse);
  }

  async listUserWarnings(
    context: AuthenticatedContext,
    userId: string,
    query: ModerationHistoryQueryDto,
  ): Promise<Paginated<WarningResponse>> {
    this.authorization.assertRoute(context, "read", "UserWarning");
    const id = await this.ensureHistoryUser(userId);
    const qb = this.warningQuery().where("warning.userId = :userId", {
      userId: id,
    });
    return this.page(qb, "warning", query, toWarningResponse);
  }

  async listRestrictions(
    context: AuthenticatedContext,
    query: RestrictionListQueryDto,
  ): Promise<Paginated<RestrictionResponse>> {
    this.authorization.assertRoute(context, "read", "PostingRestriction");
    // One instant for both the status filter and the computed status field.
    const now = new Date();
    const qb = this.restrictionQuery();
    this.applyCommonFilters(qb, "restriction", query);
    if (query.type) {
      qb.andWhere("restriction.type = :type", { type: query.type });
    }
    if (query.status) {
      qb.andWhere(restrictionStatusSql("restriction", query.status), { now });
    }
    return this.page(qb, "restriction", query, (row) =>
      toRestrictionResponse(row, now),
    );
  }

  async listUserRestrictions(
    context: AuthenticatedContext,
    userId: string,
    query: ModerationHistoryQueryDto,
  ): Promise<Paginated<RestrictionResponse>> {
    this.authorization.assertRoute(context, "read", "PostingRestriction");
    const id = await this.ensureHistoryUser(userId);
    const now = new Date();
    const qb = this.restrictionQuery().where("restriction.userId = :userId", {
      userId: id,
    });
    return this.page(qb, "restriction", query, (row) =>
      toRestrictionResponse(row, now),
    );
  }

  async getRestriction(
    context: AuthenticatedContext,
    restrictionId: string,
  ): Promise<RestrictionResponse> {
    this.authorization.assertRoute(context, "read", "PostingRestriction");
    const id = this.uuid(restrictionId, "restrictionId");
    return this.restrictionView(this.dataSource.manager, context, id);
  }

  /**
   * withDeleted() keeps soft-deleted users in joins so history never loses
   * its subject or actor. Only id + fullName are selected (D5).
   */
  private warningQuery(manager: EntityManager = this.dataSource.manager) {
    return manager
      .getRepository(UserWarningEntity)
      .createQueryBuilder("warning")
      .withDeleted()
      .leftJoin("warning.user", "target")
      .addSelect(["target.id", "target.fullName"])
      .leftJoin("warning.issuedBy", "issuer")
      .addSelect(["issuer.id", "issuer.fullName"]);
  }

  private restrictionQuery(manager: EntityManager = this.dataSource.manager) {
    return manager
      .getRepository(PostingRestrictionEntity)
      .createQueryBuilder("restriction")
      .withDeleted()
      .leftJoin("restriction.user", "target")
      .addSelect(["target.id", "target.fullName"])
      .leftJoin("restriction.issuedBy", "issuer")
      .addSelect(["issuer.id", "issuer.fullName"])
      .leftJoin("restriction.liftedBy", "lifter")
      .addSelect(["lifter.id", "lifter.fullName"]);
  }

  /** userId / issuedById / sourceReportId / [createdFrom, createdTo) (D4). */
  private applyCommonFilters<T extends ObjectLiteral>(
    qb: SelectQueryBuilder<T>,
    alias: string,
    query: WarningListQueryDto,
  ): void {
    const from = query.createdFrom ? new Date(query.createdFrom) : null;
    const to = query.createdTo ? new Date(query.createdTo) : null;
    if (from && to && from.getTime() >= to.getTime()) {
      throw new BadRequestException(
        "createdFrom must be earlier than createdTo",
      );
    }
    if (query.userId) {
      qb.andWhere(`${alias}.userId = :userId`, { userId: query.userId });
    }
    if (query.issuedById) {
      qb.andWhere(`${alias}.issuedById = :issuedById`, {
        issuedById: query.issuedById,
      });
    }
    if (query.sourceReportId) {
      qb.andWhere(`${alias}.sourceReportId = :sourceReportId`, {
        sourceReportId: query.sourceReportId,
      });
    }
    if (from) {
      qb.andWhere(`${alias}.createdAt >= :createdFrom`, { createdFrom: from });
    }
    if (to) {
      qb.andWhere(`${alias}.createdAt < :createdTo`, { createdTo: to });
    }
  }

  /** Stable order (createdAt, id) so pages never skip or repeat rows. */
  private async page<T extends ObjectLiteral, R>(
    qb: SelectQueryBuilder<T>,
    alias: string,
    query: ModerationHistoryQueryDto,
    map: (row: T) => R,
  ): Promise<Paginated<R>> {
    const order = query.order === "ASC" ? "ASC" : "DESC";
    const [rows, total] = await qb
      .orderBy(`${alias}.createdAt`, order)
      .addOrderBy(`${alias}.id`, order)
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();
    return { items: rows.map(map), meta: createPaginationMeta(query, total) };
  }

  /** History is kept for soft-deleted users; only unknown ids are 404. */
  private async ensureHistoryUser(userId: string): Promise<string> {
    const id = this.uuid(userId, "userId");
    const user = await this.dataSource.getRepository(UserEntity).findOne({
      where: { id },
      select: { id: true },
      withDeleted: true,
    });
    if (!user) throw new NotFoundException("User not found");
    return id;
  }

  private async restrictionView(
    manager: EntityManager,
    context: AuthenticatedContext,
    id: string,
  ): Promise<RestrictionResponse> {
    const row = await this.restrictionQuery(manager)
      .where("restriction.id = :id", { id })
      .getOne();
    if (!row) throw new NotFoundException("Posting restriction not found");
    this.authorization.assertResource(context, "read", "PostingRestriction", {
      id: row.id,
      userId: row.userId,
    });
    return toRestrictionResponse(row, new Date());
  }

  private async warningView(id: string): Promise<WarningResponse> {
    const row = await this.warningQuery()
      .where("warning.id = :id", { id })
      .getOneOrFail();
    return toWarningResponse(row);
  }

  // ---- Admin write API (Phase 2): thin wrappers over the Phase 1 core -----

  async adminCreateWarning(
    context: AuthenticatedContext,
    dto: CreateWarningDto,
  ): Promise<WarningResponse> {
    const warning = await this.issueWarning(context, {
      userId: dto.userId,
      reason: dto.reason,
      sourceReportId: dto.sourceReportId ?? null,
    });
    return this.warningView(warning.id);
  }

  async adminCreateRestriction(
    context: AuthenticatedContext,
    dto: CreateRestrictionDto,
  ): Promise<RestrictionResponse> {
    // ISO strings were validated (offset required, D4); convert to instants.
    const input: CreatePostingRestrictionInput = {
      userId: dto.userId,
      type: dto.type,
      reason: dto.reason,
      startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      sourceReportId: dto.sourceReportId ?? null,
    };
    // Same path as createPostingRestriction: reject before any lock, then
    // lock User → read now → validate window → insert (Phase 1 core).
    this.parseRestrictionInput(context, input);
    return this.dataSource.transaction(POSTING_ISOLATION, async (manager) => {
      const row = await this.createPostingRestrictionWithManager(
        manager,
        context,
        input,
      );
      return this.restrictionView(manager, context, row.id);
    });
  }

  async adminLiftRestriction(
    context: AuthenticatedContext,
    restrictionId: string,
    liftReason: string,
  ): Promise<RestrictionResponse> {
    const lifted = await this.liftPostingRestriction(
      context,
      restrictionId,
      liftReason,
    );
    return this.restrictionView(this.dataSource.manager, context, lifted.id);
  }

  /** Restrictions in force at `now` (unlifted, started, not yet expired). */
  async getActivePostingRestrictions(
    userId: string,
    options: PostingCheckOptions = {},
  ): Promise<PostingRestrictionEntity[]> {
    const id = this.uuid(userId, "userId");
    const now = options.now ?? new Date();
    const manager = options.manager ?? this.dataSource.manager;
    const rows = await manager
      .getRepository(PostingRestrictionEntity)
      .createQueryBuilder("restriction")
      .where("restriction.userId = :id", { id })
      .andWhere("restriction.liftedAt IS NULL")
      .andWhere("restriction.startsAt <= :now", { now })
      .andWhere(
        "(restriction.expiresAt IS NULL OR restriction.expiresAt > :now)",
        { now },
      )
      .orderBy("restriction.createdAt", "ASC")
      .getMany();
    // Same rule as the SQL above, kept as the single in-code definition.
    return rows.filter((row) => isRestrictionActive(row, now));
  }

  async getMyPostingRestrictionStatus(
    context: AuthenticatedContext,
  ): Promise<UserModerationStatusResponse> {
    const now = new Date();
    const rows = await this.dataSource
      .getRepository(PostingRestrictionEntity)
      .createQueryBuilder("restriction")
      .where("restriction.userId = :userId", {
        userId: context.principal.id,
      })
      .andWhere("restriction.liftedAt IS NULL")
      .andWhere(
        "restriction.startsAt > :now OR restriction.expiresAt IS NULL OR restriction.expiresAt > :now",
        { now },
      )
      .orderBy("restriction.startsAt", "ASC")
      .addOrderBy("restriction.id", "ASC")
      .getMany();
    const activeRestrictions = rows
      .filter((row) => isRestrictionActive(row, now))
      .map((row) => this.toUserRestrictionResponse(row, now));
    const scheduledRestrictions = rows
      .filter(
        (row) => restrictionStatus(row, now) === RestrictionStatus.SCHEDULED,
      )
      .map((row) => this.toUserRestrictionResponse(row, now));
    return {
      isRestricted: activeRestrictions.length > 0,
      activeRestrictions,
      scheduledRestrictions,
      canCreatePost: activeRestrictions.length === 0,
    };
  }

  async listMyPostingRestrictions(
    context: AuthenticatedContext,
    query: { page: number; limit: number },
  ): Promise<UserRestrictionPageResponse> {
    const [rows, total] = await this.dataSource
      .getRepository(PostingRestrictionEntity)
      .createQueryBuilder("restriction")
      .where("restriction.userId = :userId", {
        userId: context.principal.id,
      })
      .orderBy("restriction.createdAt", "DESC")
      .addOrderBy("restriction.id", "DESC")
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();
    const now = new Date();
    return {
      items: rows.map((row) => this.toUserRestrictionResponse(row, now)),
      meta: createPaginationMeta(query, total),
    };
  }

  private toUserRestrictionResponse(
    row: PostingRestrictionEntity,
    now: Date,
  ): UserRestrictionResponse {
    return {
      id: row.id,
      type: row.type,
      reason: row.reason,
      startsAt: row.startsAt.toISOString(),
      expiresAt: row.expiresAt?.toISOString() ?? null,
      status: restrictionStatus(row, now),
      createdAt: row.createdAt.toISOString(),
      liftedAt: row.liftedAt?.toISOString() ?? null,
    };
  }

  async isPostingRestricted(
    userId: string,
    options: PostingCheckOptions = {},
  ): Promise<boolean> {
    return (
      (await this.getActivePostingRestrictions(userId, options)).length > 0
    );
  }

  /**
   * The single User-row lock shared by restriction create, post create and
   * post restore. Must be the first lock those transactions take (lock order
   * User → Post). Returns the clock read *after* the lock is granted, so all
   * comparisons in the operation use one instant that is ordered after any
   * transaction that held the lock before us.
   *
   * FOR NO KEY UPDATE serializes these operations with each other while
   * still allowing FK KEY SHARE locks (e.g. notification inserts for the
   * same user), so unrelated flows are not blocked.
   */
  async lockPostingUser(manager: EntityManager, userId: string): Promise<Date> {
    const id = this.uuid(userId, "userId");
    const user = await manager
      .getRepository(UserEntity)
      .createQueryBuilder("user")
      .select("user.id")
      .setLock("for_no_key_update")
      .where("user.id = :id", { id })
      .getOne();
    if (!user) throw new NotFoundException("User not found");
    return new Date();
  }

  /**
   * Enforcement point for creating/restoring posts. Only call after
   * `lockPostingUser` in the same transaction. Warnings are never consulted.
   * Admins are not exempt.
   */
  async assertCanPost(
    manager: EntityManager,
    userId: string,
    now: Date,
  ): Promise<void> {
    const restriction = mostSevereRestriction(
      await this.getActivePostingRestrictions(userId, { manager, now }),
    );
    if (restriction) throw postingRestrictedException(restriction);
  }

  /** Lock the user row, then check restrictions at the post-lock instant. */
  async lockAndAssertCanPost(
    manager: EntityManager,
    userId: string,
  ): Promise<void> {
    const now = await this.lockPostingUser(manager, userId);
    await this.assertCanPost(manager, userId, now);
  }

  private parseRestrictionInput(
    context: AuthenticatedContext,
    input: CreatePostingRestrictionInput,
  ): { userId: string; reason: string; sourceReportId: string | null } {
    this.assertKnownFields(input, RESTRICTION_FIELDS);
    this.authorization.assertRoute(context, "create", "PostingRestriction");
    const userId = this.uuid(input.userId, "userId");
    const reason = this.reason(input.reason, "reason");
    const sourceReportId = this.optionalUuid(
      input.sourceReportId,
      "sourceReportId",
    );
    assertRestrictionShape(input.type, input.startsAt, input.expiresAt);
    this.assertNotSelf(context, userId);
    this.authorization.assertCreate(context, "PostingRestriction", { userId });
    return { userId, reason, sourceReportId };
  }

  private assertKnownFields(input: object, allowed: Set<string>): void {
    if (!input || typeof input !== "object") {
      throw new BadRequestException("Invalid moderation input");
    }
    for (const key of Object.keys(input)) {
      if (!allowed.has(key)) {
        throw new BadRequestException(`Unknown moderation field: ${key}`);
      }
    }
  }

  private uuid(value: unknown, field: string): string {
    if (typeof value !== "string" || !isUUID(value)) {
      throw new BadRequestException(`${field} must be a UUID`);
    }
    return value.toLowerCase();
  }

  private optionalUuid(value: unknown, field: string): string | null {
    return value === undefined || value === null
      ? null
      : this.uuid(value, field);
  }

  private reason(value: unknown, field: string): string {
    if (typeof value !== "string" || value.trim() === "") {
      throw new BadRequestException(`${field} is required`);
    }
    const reason = value.trim();
    // D3: same limit as the DTO, also enforced for direct service callers.
    if (Array.from(reason).length > MODERATION_REASON_MAX) {
      throw new BadRequestException(
        `${field} must be at most ${MODERATION_REASON_MAX} characters`,
      );
    }
    return reason;
  }

  private assertNotSelf(context: AuthenticatedContext, userId: string): void {
    if (context.principal.id.toLowerCase() === userId.toLowerCase()) {
      throw new ForbiddenException("You cannot moderate your own account");
    }
  }

  private async ensureTargetUser(
    manager: EntityManager,
    userId: string,
  ): Promise<void> {
    const user = await manager
      .getRepository(UserEntity)
      .findOne({ where: { id: userId }, select: { id: true } });
    if (!user) throw new NotFoundException("User not found");
  }

  /** A report may only justify action against the user it concerns. */
  private async ensureReportConcernsUser(
    manager: EntityManager,
    reportId: string,
    userId: string,
  ): Promise<void> {
    const report = await manager.getRepository(ReportEntity).findOne({
      where: { id: reportId },
      select: { id: true, targetType: true, targetId: true },
    });
    if (!report) throw new NotFoundException("Report not found");
    let concernedUserId: string | null = null;
    if (report.targetType === ReportTargetType.USER) {
      concernedUserId = report.targetId;
    } else if (report.targetType === ReportTargetType.POST) {
      const post = await manager.getRepository(PostEntity).findOne({
        where: { id: report.targetId },
        select: { id: true, sellerId: true },
        withDeleted: true,
      });
      concernedUserId = post?.sellerId ?? null;
    }
    if (concernedUserId?.toLowerCase() !== userId) {
      throw new BadRequestException("Report does not concern this user");
    }
  }
}
