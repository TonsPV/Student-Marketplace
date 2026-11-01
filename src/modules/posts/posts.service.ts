import { Promotion } from "../promotions/promotion.entity";
import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
  DataSource,
  EntityManager,
  IsNull,
  Not,
  Raw,
  Repository,
  SelectQueryBuilder,
} from "typeorm";

import { createPaginationMeta } from "../../common/utils/pagination.util";
import { CategoryEntity } from "../categories/category.entity";
import { CreatePostDto } from "./dto/create-post.dto";
import { FindPostsDto } from "./dto/find-posts.dto";
import { FindMyPostsDto } from "./dto/find-my-posts.dto";
import { SearchPostsDto } from "./dto/search-posts.dto";
import { UpdatePostDto } from "./dto/update-post.dto";
import { PostEntity, PostStatus } from "./post.entity";
import { AuthorizationService } from "../authorization/authorization.service";
import type {
  AuthenticatedContext,
  AuthorizationContext,
} from "../authorization/authorization.types";
import { StorageService } from "../storage/storage.service";
import { resolveAvatar } from "../storage/avatar-response";
import { toPostProjection } from "../authorization/subject-projections";
import { ConversationEntity } from "../conversations/entities/conversation.entity";
import { MessageEntity } from "../messages/entities/message.entity";
import { ReviewEntity } from "../reviews/review.entity";
import {
  NotificationEntity,
  NotificationType,
} from "../notifications/notification.entity";
import { RealtimeService } from "../realtime/realtime.service";
import { WS_EVENTS } from "../realtime/realtime.events";
import { MarkPostSoldDto } from "./dto/mark-post-sold.dto";
import { PurchaseReviewStatus } from "./dto/purchased-post-response.dto";
import { sellerStatistics } from "../reviews/seller-statistics";
import { ReputationLevel } from "../reviews/reputation-level";
import { PostImageEntity } from "../post-images/post-image.entity";
import {
  ModerationService,
  POSTING_ISOLATION,
} from "../moderation/moderation.service";
import { PostSort } from "./dto/post-sort";
import { postExpiresAt } from "../../config/post-expiration.config";
import {
  LISTING_EXPIRY_PREDICATE,
  activePromotionExpression,
  reputationCaseExpression,
  reputationPriorityExpression,
  reputationSubquery,
} from "./listing-ranking";

@Injectable()
export class PostsService {
  private readonly logger = new Logger(PostsService.name);

  constructor(
    @InjectRepository(PostEntity)
    private readonly postsRepository: Repository<PostEntity>,
    @InjectRepository(CategoryEntity)
    private readonly categoriesRepository: Repository<CategoryEntity>,
    private readonly authorization: AuthorizationService,
    private readonly dataSource: DataSource,
    private readonly storage: StorageService,
    private readonly moderation: ModerationService,
    @InjectRepository(ConversationEntity)
    @Optional()
    private readonly conversationsRepository?: Repository<ConversationEntity>,
    @InjectRepository(MessageEntity)
    @Optional()
    private readonly messagesRepository?: Repository<MessageEntity>,
    @InjectRepository(ReviewEntity)
    @Optional()
    private readonly reviewsRepository?: Repository<ReviewEntity>,
    @Optional()
    private readonly realtime?: RealtimeService,
    private readonly lifecycle: PostLifecycleService = new PostLifecycleService(
      dataSource,
      authorization,
      new PostActivationPolicyService(),
    ),
  ) {}

  async create(dto: CreatePostDto, context: AuthenticatedContext) {
    return this.dataSource.transaction(POSTING_ISOLATION, (manager) =>
      this.createWithManager(manager, dto, context),
    );
  }

  /**
   * Runs inside the caller's READ COMMITTED transaction. Lock order:
   * seller User row (shared posting lock) → then the new Post row.
   */
  async createWithManager(
    manager: EntityManager,
    dto: CreatePostDto,
    context: AuthenticatedContext,
  ) {
    this.authorization.assertCreate(context, "Post", {
      sellerId: context.principal.id,
    });
    const input = this.authorization.effectivePatch({ ...dto });
    const fields = new Set([
      "categoryId",
      "title",
      "description",
      "price",
      "condition",
      "location",
      "locationName",
    ]);
    if (Object.keys(input).some((field) => !fields.has(field))) {
      throw new BadRequestException("Unknown post field");
    }
    // Posting restriction (not account lock): blocks only new posts.
    await this.moderation.lockAndAssertCanPost(manager, context.principal.id);
    await this.ensureCategoryExists(dto.categoryId, manager);

    const repo = manager.getRepository(PostEntity);
    const post = repo.create({
      categoryId: dto.categoryId,
      title: dto.title,
      description: dto.description,
      price: dto.price,
      condition: dto.condition,
      location: this.toStoredLocation(dto.location),
      locationName: dto.locationName ?? null,
      sellerId: context.principal.id,
      // Phase 4 Step 2: every new listing gets a lifetime from the
      // centralized POST_EXPIRATION_DAYS config (proposed default 30 days).
      expiresAt: postExpiresAt(new Date()),
    });

    return this.toResponse(await repo.save(post));
  }

  /**
   * Public listing feed. Phase 4: RECOMMENDED (reputation priority with an
   * active-promotion boost) is the default sort, replacing the previous
   * createdAt DESC — intentional, not a silent revert. The legacy
   * findAndCount branch removed in Step 2 was unreachable dead code (the
   * DTO defaults `sort` to RECOMMENDED) and returned sellers without
   * reputation fields; every response now carries the unified ranking.
   * Eligibility: ACTIVE, not soft-deleted, and `expires_at IS NULL OR
   * expires_at > now` (now bound once per request as :listingNow).
   */
  async findAll(query: FindPostsDto, context: AuthorizationContext) {
    this.authorization.assertRoute(context, "read", "Post");
    const { page, limit, categoryId } = query;
    const builder = this.listingQueryBuilder()
      .where("post.status = :status", { status: PostStatus.ACTIVE })
      .andWhere("post.deleted_at IS NULL")
      .andWhere(LISTING_EXPIRY_PREDICATE, { listingNow: new Date() });
    if (categoryId)
      builder.andWhere("post.category_id = :categoryId", { categoryId });
    this.applyReputationFilter(builder, query.reputationLevel);
    // Total is computed BEFORE the order/sort stage so the COUNT query never
    // references the promotion-boost output alias (same shape as `search`).
    const total = await builder.clone().getCount();
    this.applyListingOrder(builder, query.sort);
    const { entities, raw } = await builder
      .skip((page - 1) * limit)
      .take(limit)
      .getRawAndEntities();
    return {
      items: await this.withListThumbnails(
        entities.map((post, index) =>
          this.withListingReputation(post, raw[index]),
        ),
      ),
      meta: createPaginationMeta(query, total),
    };
  }

  async findMyPosts(context: AuthenticatedContext, query: FindMyPostsDto) {
    this.authorization.assertRoute(context, "read", "Post");
    const { page, limit, categoryId } = query;
    const [items, total] = await this.postsRepository.findAndCount({
      withDeleted: query.deleted === "true",
      where: (query.status === PostStatus.EXPIRED
        ? [PostStatus.ACTIVE, PostStatus.EXPIRED]
        : [query.status]
      ).map((status) => ({
        sellerId: context.principal.id,
        ...(query.deleted === "true" ? { deletedAt: Not(IsNull()) } : {}),
        ...(status ? { status } : {}),
        ...(status === PostStatus.ACTIVE
          ? {
              expiresAt: Raw(
                (alias) =>
                  `${alias} ${query.status === PostStatus.EXPIRED ? "<=" : ">"} statement_timestamp()`,
              ),
            }
          : {}),
        ...(categoryId ? { categoryId } : {}),
      })),
      relations: {
        category: true,
      },
      select: {
        category: {
          id: true,
          name: true,
        },
      },
      order: {
        createdAt: "DESC",
        id: "DESC",
      },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      items: await this.withPromotionMetadata(
        items.map((post) => this.toResponse(post)),
      ),
      meta: createPaginationMeta(query, total),
    };
  }

  async search(query: SearchPostsDto, context: AuthorizationContext) {
    this.authorization.assertRoute(context, "read", "Post");
    const { q, categoryId, minPrice, maxPrice, lat, lng, radius, page, limit } =
      query;

    if (
      minPrice !== undefined &&
      maxPrice !== undefined &&
      minPrice > maxPrice
    ) {
      throw new BadRequestException(
        "minPrice must be less than or equal to maxPrice",
      );
    }

    const hasLocationFilter =
      lat !== undefined && lng !== undefined && radius !== undefined;

    const queryBuilder = this.postsRepository
      .createQueryBuilder("post")
      .leftJoin("post.seller", "seller")
      .addSelect([
        "seller.id",
        "seller.fullName",
        "seller.avatarUrl",
        "seller.avatarStorageKey",
      ])
      .leftJoin("post.category", "category")
      .addSelect(["category.id", "category.name"])
      .where("post.status = :status", { status: PostStatus.ACTIVE })
      .andWhere("post.deleted_at IS NULL")
      .andWhere(LISTING_EXPIRY_PREDICATE, { listingNow: new Date() });
    this.joinListingReputation(queryBuilder);
    this.applyReputationFilter(queryBuilder, query.reputationLevel);

    if (q) {
      const schema =
        (this.dataSource.options as { schema?: string }).schema ?? "public";
      if (!/^[a-z][a-z0-9_]*$/.test(schema))
        throw new Error("Invalid POSTGRES_SCHEMA");
      const normalize = `"${schema}".post_search_unaccent`;
      const keywords = [...new Set(q.trim().split(/\s+/).filter(Boolean))];
      keywords.forEach((keyword, index) => {
        const parameter = `keyword${index}`;
        // Every token must occur in the title, in any order.
        queryBuilder.andWhere(
          `${normalize}(post.title) ILIKE ${normalize}(:${parameter})`,
          { [parameter]: `%${keyword}%` },
        );
      });
    }

    if (categoryId) {
      queryBuilder.andWhere("post.category_id = :categoryId", { categoryId });
    }

    if (query.sellerId) {
      queryBuilder.andWhere("post.seller_id = :sellerId", {
        sellerId: query.sellerId,
      });
    }
    if (query.excludePostId) {
      queryBuilder.andWhere("post.id != :excludePostId", {
        excludePostId: query.excludePostId,
      });
    }

    if (minPrice !== undefined) {
      queryBuilder.andWhere("post.price >= :minPrice", { minPrice });
    }

    if (maxPrice !== undefined) {
      queryBuilder.andWhere("post.price <= :maxPrice", { maxPrice });
    }

    if (hasLocationFilter) {
      const searchPoint =
        "ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography";

      queryBuilder
        .addSelect(`ST_Distance(post.location, ${searchPoint})`, "distance")
        .andWhere("post.location IS NOT NULL")
        .andWhere(`ST_DWithin(post.location, ${searchPoint}, :radius)`, {
          lat,
          lng,
          radius,
        });
    }

    const schema =
      (this.dataSource.options as { schema?: string }).schema ?? "public";
    if (!/^[a-z][a-z0-9_]*$/.test(schema)) throw new Error("Invalid schema");
    queryBuilder.addSelect(
      `(SELECT MAX(pr."endsAt") FROM "${schema}".post_promotions pr WHERE pr."postId"=post.id AND pr."startsAt"<=CURRENT_TIMESTAMP AND pr."endsAt">CURRENT_TIMESTAMP)`,
      "promoted_until",
    );
    queryBuilder.addSelect(
      `CASE WHEN (SELECT COUNT(*) FROM "${schema}".post_promotions pr WHERE pr."postId"=post.id AND pr."startsAt"<=CURRENT_TIMESTAMP AND pr."endsAt">CURRENT_TIMESTAMP)>0 THEN 1 ELSE 0 END`,
      "promotion_priority",
    );
    const total = await queryBuilder.clone().getCount();
    const { entities, raw } = await this.applyListingOrder(
      queryBuilder,
      query.sort,
    )
      .skip((page - 1) * limit)
      .take(limit)
      .getRawAndEntities();

    const cards = await this.withListThumbnails(
      entities.map((post, index) =>
        this.withListingReputation(post, raw[index]),
      ),
    );
    const items = cards.map((post, index) => ({
      ...post,
      isPromoted: !!raw[index].promoted_until,
      promotedUntil: raw[index].promoted_until ?? null,
      distance: hasLocationFilter ? Number(raw[index].distance) : null,
    }));

    return {
      items,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string, context: AuthorizationContext) {
    const post = await this.postsRepository.findOne({
      where: [
        {
          id,
          status: PostStatus.ACTIVE,
          expiresAt: Raw((alias) => `${alias} > statement_timestamp()`),
        },
        { id, status: PostStatus.SOLD },
      ],
      relations: {
        seller: true,
        category: true,
      },
      select: {
        seller: {
          id: true,
          fullName: true,
          avatarUrl: true,
          avatarStorageKey: true,
          university: true,
          createdAt: true,
        },
        category: {
          id: true,
          name: true,
        },
      },
    });

    if (!post || post.deletedAt) {
      throw new NotFoundException("Post not found");
    }
    {
      this.authorization.assertResource(
        context,
        "read",
        "Post",
        toPostProjection({
          id: post.id,
          sellerId: post.sellerId,
          status: post.status,
          deletedAt: post.deletedAt,
        }) as unknown as Record<string, unknown>,
      );
    }

    const result = await this.withSellerAvatar(post);
    const stats = await sellerStatistics(this.dataSource, post.sellerId);
    // Public seller projection: never serialize account credentials or contact details.
    return {
      ...result,
      seller: result.seller
        ? {
            id: result.seller.id,
            fullName: result.seller.fullName,
            avatarUrl: result.seller.avatarUrl,
            ...("avatarUrlExpiresAt" in result.seller
              ? { avatarUrlExpiresAt: result.seller.avatarUrlExpiresAt }
              : {}),
            university: post.seller.university,
            createdAt: post.seller.createdAt,
            ...stats,
          }
        : null,
    };
  }

  async getReadablePost(id: string, context?: AuthorizationContext) {
    if (context?.kind === "authenticated") {
      const owned = await this.postsRepository.findOneBy({
        id,
        sellerId: context.principal.id,
      });
      if (owned) return owned;
    }
    const post = await this.postsRepository.findOne({
      where: [
        {
          id,
          status: PostStatus.ACTIVE,
          expiresAt: Raw((alias) => `${alias} > statement_timestamp()`),
        },
        { id, status: PostStatus.SOLD },
      ],
    });
    if (!post) throw new NotFoundException("Post not found");
    return post;
  }

  async withSellerAvatar(post: PostEntity) {
    const result = this.toResponse(post);
    if (!post.seller) return result;
    const { avatarStorageKey: _key, ...seller } = post.seller;
    return {
      ...result,
      seller: {
        ...seller,
        ...(await resolveAvatar(this.storage, post.seller)),
      },
    };
  }

  private async withPromotionMetadata<
    T extends { id: string; status?: string },
  >(posts: T[]) {
    if (!posts.length) return [];
    const promotions = await this.dataSource
      .getRepository(Promotion)
      .createQueryBuilder("pr")
      .where('pr."postId" IN (:...ids)', { ids: posts.map((p) => p.id) })
      .andWhere(
        'pr."endsAt">CURRENT_TIMESTAMP AND pr."startsAt"<=CURRENT_TIMESTAMP',
      )
      .getMany();
    return posts.map((p) => {
      const ends = promotions
        .filter((pr) => pr.postId === p.id)
        .map((pr) => pr.endsAt)
        .sort((a, b) => b.getTime() - a.getTime())[0];
      return {
        ...p,
        isPromoted: p.status === "active" && !!ends,
        promotedUntil: p.status === "active" ? (ends ?? null) : null,
      };
    });
  }

  private async withListThumbnails(posts: PostEntity[]) {
    if (posts.length === 0) return [];

    // Batch only the first image of each authorized, paginated post. Joining
    // galleries into the paginated query would multiply rows and load unused images.
    const images = await this.dataSource
      .getRepository(PostImageEntity)
      .createQueryBuilder("image")
      .select(["image.id", "image.postId", "image.url", "image.storageKey"])
      .distinctOn(["image.postId"])
      .where("image.postId IN (:...postIds)", {
        postIds: posts.map((post) => post.id),
      })
      .orderBy("image.postId", "ASC")
      .addOrderBy("image.id", "ASC")
      .getMany();
    const covers = new Map(images.map((image) => [image.postId, image]));

    return Promise.all(
      posts.map(async (post) => {
        const image = covers.get(post.id);
        let thumbnailUrl: string | null = image?.url ?? null;
        let thumbnailUrlExpiresAt: string | undefined;
        if (image?.storageKey) {
          try {
            const signed = await this.storage.presignGet(image.storageKey);
            thumbnailUrl = signed.url;
            thumbnailUrlExpiresAt = signed.expiresAt;
          } catch {
            // A missing thumbnail must not prevent the entire feed from loading.
            this.logger.warn(`Could not sign thumbnail for post ${post.id}`);
          }
        }
        const { images: _gallery, ...card } = await this.withSellerAvatar(post);
        return {
          ...card,
          thumbnailUrl,
          ...(thumbnailUrlExpiresAt ? { thumbnailUrlExpiresAt } : {}),
        };
      }),
    );
  }

  async getActivePost(id: string) {
    const post = await this.postsRepository.findOne({
      where: {
        id,
        status: PostStatus.ACTIVE,
        expiresAt: Raw((alias) => `${alias} > statement_timestamp()`),
      },
    });

    if (!post) {
      throw new NotFoundException("Post not found");
    }

    return post;
  }

  async update(id: string, dto: UpdatePostDto, context: AuthenticatedContext) {
    return this.dataSource.transaction(async (manager) => {
      const post = await manager
        .getRepository(PostEntity)
        .createQueryBuilder("post")
        .setLock("pessimistic_write")
        .where("post.id = :id", { id })
        .getOne();
      if (!post) throw new NotFoundException("Post not found");
      const projection = toPostProjection({
        id: post.id,
        sellerId: post.sellerId,
        status: post.status,
        deletedAt: post.deletedAt,
      }) as unknown as Record<string, unknown>;
      const patch: Record<string, unknown> = { ...dto };
      this.authorization.assertUpdateFields(
        context,
        "update",
        "Post",
        projection,
        patch,
      );
      if (post.status === PostStatus.HIDDEN) {
        throw new BadRequestException("Hidden posts cannot be updated");
      }
      if (dto.categoryId !== undefined) {
        await this.ensureCategoryExists(dto.categoryId, manager);
      }
      const effective = this.authorization.effectivePatch(patch);
      if (Object.hasOwn(effective, "location")) {
        effective.location = this.toStoredLocation(dto.location);
      }
      Object.assign(post, effective);
      return this.toResponse(
        await manager.getRepository(PostEntity).save(post),
      );
    });
  }

  async markAsSold(
    id: string,
    dtoOrContext: MarkPostSoldDto | AuthenticatedContext,
    maybeContext?: AuthenticatedContext,
  ) {
    if (
      maybeContext &&
      !Object.prototype.hasOwnProperty.call(dtoOrContext, "buyerId")
    ) {
      throw new BadRequestException("buyerId must be provided and may be null");
    }
    const dto = maybeContext
      ? ((dtoOrContext as MarkPostSoldDto | undefined) ?? { buyerId: null })
      : { buyerId: null };
    const context = maybeContext ?? (dtoOrContext as AuthenticatedContext);
    let notificationBuyerId: string | null = null;
    const result = await this.dataSource.transaction(async (manager) => {
      const post = await manager
        .getRepository(PostEntity)
        .createQueryBuilder("post")
        .setLock("pessimistic_write")
        .where("post.id = :id", { id })
        .getOne();
      if (!post) throw new NotFoundException("Post not found");
      this.authorization.assertResource(
        context,
        "markSold",
        "Post",
        toPostProjection({
          id: post.id,
          sellerId: post.sellerId,
          status: post.status,
          deletedAt: post.deletedAt,
        }) as unknown as Record<string, unknown>,
      );
      if (post.status === PostStatus.HIDDEN) {
        throw new BadRequestException("Hidden posts cannot be marked as sold");
      }
      if (post.status === PostStatus.SOLD) {
        if (post.buyerId !== dto.buyerId) {
          throw new BadRequestException(
            "The post has already been sold to another buyer",
          );
        }
        return this.toResponse(post);
      }
      if (dto.buyerId !== null) {
        if (dto.buyerId === post.sellerId) {
          throw new BadRequestException("Buyer must be different from seller");
        }
        const candidate = await manager
          .getRepository(ConversationEntity)
          .createQueryBuilder("conversation")
          .innerJoin(
            MessageEntity,
            "message",
            "message.conversation_id = conversation.id AND message.sender_id = :buyerId",
            { buyerId: dto.buyerId },
          )
          .where("conversation.post_id = :postId", { postId: id })
          .andWhere("conversation.seller_id = :sellerId", {
            sellerId: post.sellerId,
          })
          .andWhere("conversation.buyer_id = :buyerId", {
            buyerId: dto.buyerId,
          })
          .getOne();
        if (!candidate) {
          throw new BadRequestException("Buyer has not contacted this post");
        }
        notificationBuyerId = dto.buyerId;
      }
      post.status = PostStatus.SOLD;
      post.buyerId = dto.buyerId;
      post.soldAt = new Date();
      const saved = await manager.getRepository(PostEntity).save(post);
      if (notificationBuyerId) {
        const notificationRepository =
          manager.getRepository(NotificationEntity);
        const existingNotification = await notificationRepository.findOneBy({
          userId: notificationBuyerId,
          type: NotificationType.REVIEW_REQUEST,
          refId: saved.id,
        });
        if (!existingNotification) {
          await notificationRepository.save(
            notificationRepository.create({
              userId: notificationBuyerId,
              type: NotificationType.REVIEW_REQUEST,
              refId: saved.id,
              title: "Review your purchase",
              body: "You can review this purchase within 30 days.",
              isRead: false,
            }),
          );
        }
      }
      return this.toResponse(saved);
    });
    if (notificationBuyerId) {
      try {
        this.realtime?.emitToUser(
          notificationBuyerId,
          WS_EVENTS.NOTIFICATION_NEW,
          {
            type: NotificationType.REVIEW_REQUEST,
            refId: id,
          },
        );
      } catch (err) {
        // The sale has committed; socket failure must not fail the HTTP request.
        this.logger.error(
          `emit review notification:new failed: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    return result;
  }

  async findBuyerCandidates(id: string, context: AuthenticatedContext) {
    const post = await this.getPostForAction(id, context, "markSold");
    const candidates = await (
      this.conversationsRepository ??
      this.dataSource.getRepository(ConversationEntity)
    )
      .createQueryBuilder("conversation")
      .innerJoin("conversation.buyer", "buyer")
      .innerJoin(
        MessageEntity,
        "message",
        "message.conversation_id = conversation.id AND message.sender_id = conversation.buyer_id",
      )
      .where("conversation.post_id = :postId", { postId: id })
      .andWhere("conversation.seller_id = :sellerId", {
        sellerId: post.sellerId,
      })
      .andWhere("conversation.buyer_id <> :sellerId", {
        sellerId: post.sellerId,
      })
      .select("buyer.id", "id")
      .addSelect("buyer.full_name", "fullName")
      .addSelect("buyer.avatar_url", "avatarUrl")
      .distinct(true)
      .getRawMany<{
        id: string;
        fullName: string;
        avatarUrl: string | null;
      }>();
    return candidates.map((candidate) => ({
      id: candidate.id,
      fullName: candidate.fullName,
      avatarUrl: candidate.avatarUrl,
    }));
  }

  private async toPurchasedPostResponse(post: PostEntity) {
    return {
      id: post.id,
      sellerId: post.sellerId,
      categoryId: post.categoryId,
      title: post.title,
      description: post.description,
      price: post.price,
      condition: post.condition,
      status: post.status,
      location: post.location
        ? {
            latitude: post.location.coordinates[1],
            longitude: post.location.coordinates[0],
          }
        : null,
      locationName: post.locationName,
      createdAt: post.createdAt,
      soldAt: post.soldAt,
      seller: post.seller
        ? {
            id: post.seller.id,
            fullName: post.seller.fullName,
            ...(await resolveAvatar(this.storage, post.seller)),
          }
        : null,
      category: post.category
        ? {
            id: post.category.id,
            name: post.category.name,
          }
        : null,
    };
  }

  async findPurchased(query: FindPostsDto, context: AuthenticatedContext) {
    const { page, limit } = query;
    const [posts, total] = await this.postsRepository.findAndCount({
      where: { buyerId: context.principal.id, status: PostStatus.SOLD },
      relations: { seller: true, category: true },
      select: {
        id: true,
        sellerId: true,
        categoryId: true,
        title: true,
        description: true,
        price: true,
        condition: true,
        status: true,
        location: true,
        locationName: true,
        createdAt: true,
        soldAt: true,
        seller: {
          id: true,
          fullName: true,
          avatarUrl: true,
          avatarStorageKey: true,
        },
        category: { id: true, name: true },
      },
      order: { soldAt: "DESC" },
      skip: (page - 1) * limit,
      take: limit,
    });
    const items = await Promise.all(
      posts.map(async (post) => {
        const review = await (
          this.reviewsRepository ?? this.dataSource.getRepository(ReviewEntity)
        ).findOne({
          where: { postId: post.id },
          // A deleted review still counts as reviewed. The unique post_id
          // constraint preserves this invariant in the database.
          withDeleted: true,
        });
        if (!post.soldAt) {
          throw new InternalServerErrorException("Sold post is missing soldAt");
        }
        const reviewDeadline = new Date(
          post.soldAt.getTime() + 30 * 24 * 60 * 60 * 1000,
        );
        const canReview = !review && new Date() <= reviewDeadline;
        return {
          ...(await this.toPurchasedPostResponse(post)),
          reviewDeadline,
          review:
            review && !review.deletedAt
              ? {
                  id: review.id,
                  rating: review.rating,
                  comment: review.comment,
                  createdAt: review.createdAt,
                  updatedAt: review.updatedAt,
                }
              : null,
          canReview,
          reviewStatus: review
            ? PurchaseReviewStatus.REVIEWED
            : canReview
              ? PurchaseReviewStatus.NOT_REVIEWED
              : PurchaseReviewStatus.EXPIRED,
        };
      }),
    );
    return { items, meta: createPaginationMeta(query, total) };
  }

  async remove(id: string, context: AuthenticatedContext) {
    return this.dataSource.transaction(async (manager) => {
      const post = await manager
        .getRepository(PostEntity)
        .createQueryBuilder("post")
        .setLock("pessimistic_write")
        .where("post.id = :id", { id })
        .getOne();
      if (!post) throw new NotFoundException("Post not found");
      this.authorization.assertResource(
        context,
        "delete",
        "Post",
        toPostProjection({
          id: post.id,
          sellerId: post.sellerId,
          status: post.status,
          deletedAt: post.deletedAt,
        }) as unknown as Record<string, unknown>,
      );
      await manager.softDelete(PostEntity, id);
    });
  }

  async restore(id: string, context: AuthenticatedContext) {
    return this.dataSource.transaction(POSTING_ISOLATION, (manager) =>
      this.restoreWithManager(manager, id, context),
    );
  }

  /**
   * Lock order User → Post, the same as create. The seller id is read
   * without a lock first (it never changes) so the seller row can be locked
   * before the post row; it is re-checked after both locks are held.
   */
  async restoreWithManager(
    manager: EntityManager,
    id: string,
    context: AuthenticatedContext,
  ) {
    const repo = manager.getRepository(PostEntity);
    const assertCanRestore = (post: PostEntity) =>
      this.authorization.assertResource(
        context,
        "restore",
        "Post",
        toPostProjection({
          id: post.id,
          sellerId: post.sellerId,
          status: post.status,
          deletedAt: post.deletedAt,
        }) as unknown as Record<string, unknown>,
      );
    const unlocked = await repo.findOne({ where: { id }, withDeleted: true });
    if (!unlocked) throw new NotFoundException("Post not found");
    // Reject outsiders before taking any lock on someone else's rows.
    assertCanRestore(unlocked);
    if (!unlocked.deletedAt) return this.toResponse(unlocked);

    // Restoring puts a listing back on the marketplace: the seller's
    // restriction applies, checked at the instant the user lock is granted.
    const now = await this.moderation.lockPostingUser(
      manager,
      unlocked.sellerId,
    );
    const post = await repo
      .createQueryBuilder("post")
      .withDeleted()
      .setLock("pessimistic_write")
      .where("post.id = :id", { id })
      .getOne();
    if (!post) throw new NotFoundException("Post not found");
    if (post.sellerId !== unlocked.sellerId) {
      throw new ConflictException("Post owner changed");
    }
    assertCanRestore(post);
    if (!post.deletedAt) return this.toResponse(post);
    await this.moderation.assertCanPost(manager, post.sellerId, now);
    // Proposed policy (Phase 4 Step 2, needs confirmation): re-publishing a
    // listing whose lifetime is null (legacy) or already over grants it a
    // fresh window from POST_EXPIRATION_DAYS; unexpired lifetimes are kept.
    if (!post.expiresAt || post.expiresAt.getTime() <= now.getTime()) {
      post.expiresAt = postExpiresAt(now);
      await repo.update(id, { expiresAt: post.expiresAt });
    }
    await repo.restore(id);
    return this.toResponse(await repo.findOneByOrFail({ id }));
  }

  async getOwnedPost(
    id: string,
    context: AuthenticatedContext,
    withDeleted = false,
  ) {
    const post = await this.postsRepository.findOne({
      where: { id, sellerId: context.principal.id },
      withDeleted,
    });

    if (!post || (!withDeleted && post.deletedAt)) {
      throw new NotFoundException("Post not found");
    }
    this.authorization.assertResource(
      context,
      "read",
      "Post",
      toPostProjection({
        id: post.id,
        sellerId: post.sellerId,
        status: post.status,
        deletedAt: post.deletedAt,
      }) as unknown as Record<string, unknown>,
    );
    return post;
  }

  async getPostForAction(
    id: string,
    context: AuthenticatedContext,
    action: "update" | "markSold" | "delete" | "restore" | "manageImages",
    withDeleted = false,
    manager?: EntityManager,
  ) {
    const repo = manager
      ? manager.getRepository(PostEntity)
      : this.postsRepository;
    const query = repo
      .createQueryBuilder("post")
      .where("post.id = :id", { id });
    if (withDeleted) query.withDeleted();
    if (manager) query.setLock("pessimistic_write");
    const post = await query.getOne();
    if (!post || (!withDeleted && post.deletedAt)) {
      throw new NotFoundException("Post not found");
    }
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
    return post;
  }

  private toStoredLocation(
    location: CreatePostDto["location"],
  ): PostEntity["location"] {
    return location == null
      ? null
      : {
          type: "Point",
          coordinates: [location.longitude, location.latitude],
        };
  }

  private toResponse(post: PostEntity) {
    return {
      ...post,
      status:
        post.status === PostStatus.ACTIVE &&
        post.expiresAt?.getTime() <= Date.now()
          ? PostStatus.EXPIRED
          : post.status,
      freeRenewalAvailable: post.renewalCount === 0,
      location: post.location
        ? {
            latitude: post.location.coordinates[1],
            longitude: post.location.coordinates[0],
          }
        : null,
    };
  }

  private listingQueryBuilder() {
    const builder = this.postsRepository
      .createQueryBuilder("post")
      .leftJoin("post.seller", "seller")
      .addSelect([
        "seller.id",
        "seller.fullName",
        "seller.avatarUrl",
        "seller.avatarStorageKey",
      ])
      .leftJoin("post.category", "category")
      .addSelect(["category.id", "category.name"]);
    this.joinListingReputation(builder);
    return builder;
  }

  /** Validated schema for schema-qualified subqueries (consistent with search). */
  private listingSchema(): string {
    const options = this.dataSource.options as
      | { schema?: string }
      | undefined;
    const schema = options?.schema ?? "public";
    if (!/^[a-z][a-z0-9_]*$/.test(schema))
      throw new Error("Invalid POSTGRES_SCHEMA");
    return schema;
  }

  private joinListingReputation(builder: SelectQueryBuilder<PostEntity>): void {
    builder
      .leftJoin(
        reputationSubquery(this.listingSchema()),
        "reputation",
        "reputation.seller_id = post.seller_id",
      )
      .addSelect("reputation.review_count", "sellerReviewCount")
      .addSelect("reputation.rating_average", "sellerRatingAverage")
      .addSelect(reputationCaseExpression(), "sellerReputationLevel");
  }

  private applyReputationFilter(
    builder: SelectQueryBuilder<PostEntity>,
    level?: ReputationLevel,
  ): void {
    if (level) {
      builder.andWhere(
        `${reputationCaseExpression()} = :reputationLevel`,
        {
          reputationLevel: level,
        },
      );
    }
  }

  private applyListingOrder(
    builder: SelectQueryBuilder<PostEntity>,
    sort: PostSort = PostSort.RECOMMENDED,
  ): SelectQueryBuilder<PostEntity> {
    if (sort === PostSort.PRICE_ASC) {
      return builder.orderBy("post.price", "ASC").addOrderBy("post.id", "DESC");
    }
    if (sort === PostSort.PRICE_DESC) {
      return builder
        .orderBy("post.price", "DESC")
        .addOrderBy("post.id", "DESC");
    }
    if (sort === PostSort.NEWEST) {
      return builder
        .orderBy("post.createdAt", "DESC")
        .addOrderBy("post.id", "DESC");
    }
    if (sort === PostSort.REPUTATION_HIGH_TO_LOW) {
      // Pure reputation ordering by design: NO promotion boost here (Phase 4
      // Step 2 §C4) — this sort means "best reputation first", nothing else.
      return builder
        .orderBy(reputationPriorityExpression(), "DESC")
        .addOrderBy("reputation.rating_average", "DESC", "NULLS LAST")
        .addOrderBy("reputation.review_count", "DESC", "NULLS LAST")
        .addOrderBy("post.createdAt", "DESC")
        .addOrderBy("post.id", "DESC");
    }
    // RECOMMENDED — Unified Ranking: reputation level first, then an active
    // promotion (still inside the same reputation level, so a boosted LOW
    // post can never outrank an EXCELLENT one), then rating/count/createdAt
    // and a stable id tie-breaker. The 0/1 boost is a select output column
    // (EXISTS, never a JOIN — no post duplication) and relies on the
    // :listingNow parameter that every listing path binds exactly once.
    builder.addSelect(
      activePromotionExpression(this.listingSchema()),
      "has_active_promotion",
    );
    return builder
      .orderBy(reputationPriorityExpression(), "DESC")
      .addOrderBy("has_active_promotion", "DESC")
      .addOrderBy("reputation.rating_average", "DESC", "NULLS LAST")
      .addOrderBy("reputation.review_count", "DESC", "NULLS LAST")
      .addOrderBy("post.createdAt", "DESC")
      .addOrderBy("post.id", "DESC");
  }

  private withListingReputation(
    post: PostEntity,
    raw: Record<string, unknown>,
  ): PostEntity {
    if (post.seller) {
      Object.assign(post.seller, {
        ratingAverage:
          raw.sellerRatingAverage == null
            ? null
            : Number(raw.sellerRatingAverage),
        reviewCount: Number(raw.sellerReviewCount ?? 0),
        reputationLevel: raw.sellerReputationLevel,
      });
    }
    return post;
  }

  private async ensureCategoryExists(
    categoryId: string,
    manager?: EntityManager,
  ) {
    const repo = manager
      ? manager.getRepository(CategoryEntity)
      : this.categoriesRepository;
    const category = await repo.findOneBy({
      id: categoryId,
    });

    if (!category) {
      throw new NotFoundException("Category not found");
    }
  }
}
