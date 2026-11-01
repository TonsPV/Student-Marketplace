import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DataSource, EntityManager, MoreThan } from "typeorm";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { createPaginationMeta } from "../../common/utils/pagination.util";
import { AuthorizationService } from "../authorization/authorization.service";
import type { AuthenticatedContext } from "../authorization/authorization.types";
import { toPostProjection } from "../authorization/subject-projections";
import { CategoryEntity } from "../categories/category.entity";
import { UserEntity } from "../user/user.entity";
import { CreatePostDto } from "./dto/create-post.dto";
import {
  PostActivationPolicyService,
  PostingDecision,
} from "./post-activation-policy.service";
import {
  DAY_MS,
  POST_LIFETIME_DAYS,
  POST_QUOTA,
  POST_REMINDER_DAYS,
} from "./post-lifecycle.constants";
import { PostEntity, PostStatus } from "./post.entity";
import { PostRenewalEntity, PostRenewalKind } from "./post-renewal.entity";

@Injectable()
export class PostLifecycleService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly authorization: AuthorizationService,
    private readonly postingPolicy: PostActivationPolicyService,
  ) {}

  private transaction<T>(
    work: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    // A fresh snapshot after waiting for the seller lock is essential for quota.
    return this.dataSource.transaction("READ COMMITTED", work);
  }

  /** Lock order: seller -> post. Tấn must use the same seller lock for bans. */
  private async lockSeller(manager: EntityManager, sellerId: string) {
    const seller = await manager
      .getRepository(UserEntity)
      .createQueryBuilder("seller")
      .setLock("pessimistic_write")
      .where("seller.id = :sellerId", { sellerId })
      .getOne();
    if (!seller) throw new NotFoundException("Seller not found");
    if (seller.isLocked)
      throw new ForbiddenException({
        code: "ACCOUNT_LOCKED",
        message: "Account is locked",
      });
  }

  private async now(manager: EntityManager): Promise<Date> {
    const [row] = await manager.query("SELECT clock_timestamp() AS now");
    return new Date(row.now);
  }

  private async countActive(
    manager: EntityManager,
    sellerId: string,
    now: Date,
  ) {
    return manager.getRepository(PostEntity).countBy({
      sellerId,
      status: PostStatus.ACTIVE,
      expiresAt: MoreThan(now),
    });
  }

  private assertPostingAllowed(decision: PostingDecision) {
    if (!decision.allowed) {
      throw new ForbiddenException({
        code: "POSTING_RESTRICTED",
        message: "Posting is restricted",
        reason: decision.reason,
        blockedUntil: decision.blockedUntil,
      });
    }
  }

  private async assertActivation(
    manager: EntityManager,
    sellerId: string,
    now: Date,
  ) {
    const decision = await this.postingPolicy.evaluate(manager, sellerId);
    this.assertPostingAllowed(decision);
    const used = await this.countActive(manager, sellerId, now);
    if (used >= decision.limit) {
      throw new ConflictException({
        code: "POST_QUOTA_EXCEEDED",
        message: "Active post quota reached",
        used,
        limit: decision.limit,
      });
    }
  }

  async quota(context: AuthenticatedContext) {
    this.authorization.assertRoute(context, "create", "Post");
    return this.transaction(async (manager) => {
      const sellerId = context.principal.id;
      await this.lockSeller(manager, sellerId);
      const decision = await this.postingPolicy.evaluate(manager, sellerId);
      const used = await this.countActive(
        manager,
        sellerId,
        await this.now(manager),
      );
      return {
        maxLimit: POST_QUOTA,
        limit: decision.limit,
        used,
        remaining: Math.max(0, decision.limit - used),
        canActivate: decision.allowed && used < decision.limit,
        postingAllowed: decision.allowed,
        reason: decision.reason,
        blockedUntil: decision.blockedUntil,
        lifetimeDays: POST_LIFETIME_DAYS,
        reminderDays: POST_REMINDER_DAYS,
      };
    });
  }

  async create(dto: CreatePostDto, context: AuthenticatedContext) {
    this.authorization.assertCreate(context, "Post", {
      sellerId: context.principal.id,
    });
    if (
      dto.location != null &&
      (!Number.isFinite(dto.location.latitude) ||
        Math.abs(dto.location.latitude) > 90 ||
        !Number.isFinite(dto.location.longitude) ||
        Math.abs(dto.location.longitude) > 180)
    )
      throw new BadRequestException("Invalid post location");
    return this.transaction(async (manager) => {
      await this.lockSeller(manager, context.principal.id);
      const now = await this.now(manager);
      await this.assertActivation(manager, context.principal.id, now);
      if (
        !(await manager
          .getRepository(CategoryEntity)
          .findOneBy({ id: dto.categoryId }))
      ) {
        throw new NotFoundException("Category not found");
      }
      const repo = manager.getRepository(PostEntity);
      return repo.save(
        repo.create({
          sellerId: context.principal.id,
          categoryId: dto.categoryId,
          title: dto.title,
          description: dto.description,
          price: dto.price,
          condition: dto.condition,
          location:
            dto.location == null
              ? null
              : {
                  type: "Point",
                  coordinates: [dto.location.longitude, dto.location.latitude],
                },
          locationName: dto.locationName ?? null,
          status: PostStatus.ACTIVE,
          publishedAt: now,
          expiresAt: new Date(now.getTime() + POST_LIFETIME_DAYS * DAY_MS),
          renewalCount: 0,
        }),
      );
    });
  }

  private assertOwner(
    context: AuthenticatedContext,
    post: PostEntity,
    action: "restore" | "renew" | "read",
  ) {
    this.authorization.assertResource(
      context,
      action,
      "Post",
      toPostProjection({
        id: post.id,
        sellerId: post.sellerId,
        status: post.status,
        deletedAt: post.deletedAt,
      }) as unknown as Record<string, unknown>,
    );
    // Renewal/history endpoints are strictly for the seller, including admins.
    if (action !== "restore" && post.sellerId !== context.principal.id) {
      throw new ForbiddenException("Only the seller can perform this action");
    }
  }

  async restore(id: string, context: AuthenticatedContext) {
    return this.transaction(async (manager) => {
      const repo = manager.getRepository(PostEntity);
      const header = await repo.findOne({ where: { id }, withDeleted: true });
      if (!header) throw new NotFoundException("Post not found");
      this.assertOwner(context, header, "restore");
      await this.lockSeller(manager, header.sellerId);
      const post = await repo
        .createQueryBuilder("post")
        .withDeleted()
        .setLock("pessimistic_write")
        .where("post.id = :id", { id })
        .getOneOrFail();
      this.assertOwner(context, post, "restore");
      if (!post.deletedAt) return post;
      const now = await this.now(manager);
      if (post.status === PostStatus.ACTIVE) {
        if (post.expiresAt <= now) post.status = PostStatus.EXPIRED;
        else await this.assertActivation(manager, post.sellerId, now);
      }
      post.deletedAt = null;
      return repo.save(post);
    });
  }

  async renewFree(id: string, context: AuthenticatedContext) {
    return this.transaction((manager) =>
      this.renewWithManager(manager, id, context, null),
    );
  }

  /**
   * Server-only payment integration. The caller MUST verify payment ownership,
   * amount, success and product, then call this in the SAME DB transaction that
   * consumes the payment. Never expose paymentReference as an HTTP renewal DTO.
   * Duplicate references return without extending or charging again.
   */
  async renewPaidWithManager(
    manager: EntityManager,
    id: string,
    context: AuthenticatedContext,
    paymentReference: string,
  ) {
    if (!manager.queryRunner?.isTransactionActive)
      throw new Error("Paid renewal requires an active transaction");
    const [isolation] = await manager.query("SHOW transaction_isolation");
    if (isolation.transaction_isolation !== "read committed") {
      throw new Error("Paid renewal requires READ COMMITTED isolation");
    }
    if (!paymentReference.trim() || paymentReference.length > 150)
      throw new BadRequestException("Invalid payment reference");
    return this.renewWithManager(manager, id, context, paymentReference);
  }

  private async renewWithManager(
    manager: EntityManager,
    id: string,
    context: AuthenticatedContext,
    paymentReference: string | null,
  ) {
    await this.lockSeller(manager, context.principal.id);
    const repo = manager.getRepository(PostEntity);
    const post = await repo
      .createQueryBuilder("post")
      .setLock("pessimistic_write")
      .where("post.id = :id", { id })
      .getOne();
    if (!post) throw new NotFoundException("Post not found");
    this.assertOwner(context, post, "renew");
    const history = manager.getRepository(PostRenewalEntity);
    if (paymentReference) {
      const existing = await history.findOneBy({ paymentReference });
      if (existing) {
        if (existing.postId !== post.id)
          throw new ConflictException("Payment already used for another post");
        return post;
      }
    }
    const now = await this.now(manager);
    if (
      ![PostStatus.ACTIVE, PostStatus.EXPIRED].includes(post.status) ||
      post.soldAt
    ) {
      throw new BadRequestException({
        code: "POST_NOT_RENEWABLE",
        message: "Only expired, unsold posts can be renewed",
      });
    }
    if (post.expiresAt > now)
      throw new ConflictException({
        code: "POST_NOT_EXPIRED",
        message: "Post has not expired",
      });
    if (post.renewalCount > 0 && !paymentReference) {
      throw new ConflictException({
        code: "POST_PAYMENT_REQUIRED",
        message: "The free renewal has already been used",
      });
    }
    if (post.renewalCount === 0 && paymentReference) {
      throw new ConflictException({
        code: "POST_FREE_RENEWAL_AVAILABLE",
        message: "Use the free renewal first",
      });
    }
    await this.assertActivation(manager, post.sellerId, now);
    const previousExpiresAt = post.expiresAt;
    post.status = PostStatus.ACTIVE;
    post.publishedAt = now;
    post.expiresAt = new Date(now.getTime() + POST_LIFETIME_DAYS * DAY_MS);
    post.renewalCount += 1;
    await repo.save(post);
    await history.save(
      history.create({
        postId: post.id,
        renewalNumber: post.renewalCount,
        kind: paymentReference ? PostRenewalKind.PAID : PostRenewalKind.FREE,
        paymentReference,
        previousExpiresAt,
        publishedAt: post.publishedAt,
        expiresAt: post.expiresAt,
      }),
    );
    return post;
  }

  async renewalHistory(
    id: string,
    context: AuthenticatedContext,
    query: PaginationDto,
  ) {
    const post = await this.dataSource
      .getRepository(PostEntity)
      .findOne({ where: { id }, withDeleted: true });
    if (!post) throw new NotFoundException("Post not found");
    this.assertOwner(context, post, "read");
    const [items, total] = await this.dataSource
      .getRepository(PostRenewalEntity)
      .findAndCount({
        where: { postId: id },
        order: { renewalNumber: "DESC" },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: {
          id: true,
          postId: true,
          renewalNumber: true,
          kind: true,
          previousExpiresAt: true,
          publishedAt: true,
          expiresAt: true,
          createdAt: true,
        },
      });
    return { items, meta: createPaginationMeta(query, total) };
  }
}
