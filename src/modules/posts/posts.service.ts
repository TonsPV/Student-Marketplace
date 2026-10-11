import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Brackets, DataSource, EntityManager, In, Repository } from "typeorm";
import { ReviewEntity } from "../reviews/review.entity";

import { createPaginationMeta } from "../../common/utils/pagination.util";
import { CategoryEntity } from "../categories/category.entity";
import { CreatePostDto } from "./dto/create-post.dto";
import { FindPostsDto } from "./dto/find-posts.dto";
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

@Injectable()
export class PostsService {
  constructor(
    @InjectRepository(PostEntity)
    private readonly postsRepository: Repository<PostEntity>,
    @InjectRepository(CategoryEntity)
    private readonly categoriesRepository: Repository<CategoryEntity>,
    private readonly authorization: AuthorizationService,
    private readonly dataSource: DataSource,
    private readonly storage: StorageService,
  ) {}

  async create(dto: CreatePostDto, context: AuthenticatedContext) {
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
    await this.ensureCategoryExists(dto.categoryId);

    const post = this.postsRepository.create({
      categoryId: dto.categoryId,
      title: dto.title,
      description: dto.description,
      price: dto.price,
      condition: dto.condition,
      location: this.toStoredLocation(dto.location),
      locationName: dto.locationName ?? null,
      sellerId: context.principal.id,
    });

    return this.toResponse(await this.postsRepository.save(post));
  }

  async findAll(query: FindPostsDto, context: AuthorizationContext) {
    this.authorization.assertRoute(context, "read", "Post");
    const { page, limit, categoryId } = query;

    const [items, total] = await this.postsRepository.findAndCount({
      where: {
        status: PostStatus.ACTIVE,
        ...(categoryId ? { categoryId } : {}),
      },
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
        },
        category: {
          id: true,
          name: true,
        },
      },
      order: {
        createdAt: "DESC",
      },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      items: await Promise.all(
        items.map((post) => this.withSellerAvatar(post)),
      ),
      meta: createPaginationMeta(query, total),
    };
  }

  async findMyPosts(context: AuthenticatedContext, query: FindPostsDto) {
    this.authorization.assertRoute(context, "read", "Post");
    const { page, limit, categoryId } = query;
    const [items, total] = await this.postsRepository.findAndCount({
      where: {
        sellerId: context.principal.id,
        ...(categoryId ? { categoryId } : {}),
      },
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
      },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      items: items.map((post) => this.toResponse(post)),
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
      .where("post.status = :status", { status: PostStatus.ACTIVE })
      .andWhere("post.deleted_at IS NULL");

    if (q) {
      queryBuilder.andWhere(
        new Brackets((builder) => {
          builder
            .where("post.title ILIKE :keyword", { keyword: `%${q}%` })
            .orWhere("post.description ILIKE :keyword", {
              keyword: `%${q}%`,
            });
        }),
      );
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

    const total = await queryBuilder.clone().getCount();
    const { entities, raw } = await queryBuilder
      .orderBy("post.createdAt", "DESC")
      .skip((page - 1) * limit)
      .take(limit)
      .getRawAndEntities();

    const items = await Promise.all(
      entities.map(async (post, index) => ({
        ...(await this.withSellerAvatar(post)),
        distance: hasLocationFilter ? Number(raw[index].distance) : null,
      })),
    );

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
      where: {
        id,
        status: In([PostStatus.ACTIVE, PostStatus.SOLD]),
      },
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
    const [reviews, soldCount] = await Promise.all([
      this.dataSource
        .getRepository(ReviewEntity)
        .createQueryBuilder("review")
        .innerJoin("review.post", "post")
        .where("post.sellerId = :sellerId", { sellerId: post.sellerId })
        .select("AVG(review.rating)", "ratingAverage")
        .addSelect("COUNT(review.id)", "reviewCount")
        .getRawOne<{ ratingAverage: string | null; reviewCount: string }>(),
      this.postsRepository.countBy({
        sellerId: post.sellerId,
        status: PostStatus.SOLD,
      }),
    ]);
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
            ratingAverage:
              reviews?.ratingAverage == null
                ? null
                : Number(reviews.ratingAverage),
            reviewCount: Number(reviews?.reviewCount ?? 0),
            soldCount,
          }
        : null,
    };
  }

  async getReadablePost(id: string) {
    const post = await this.postsRepository.findOne({
      where: { id, status: In([PostStatus.ACTIVE, PostStatus.SOLD]) },
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

  async getActivePost(id: string) {
    const post = await this.postsRepository.findOne({
      where: { id, status: PostStatus.ACTIVE },
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

  async markAsSold(id: string, context: AuthenticatedContext) {
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
      post.status = PostStatus.SOLD;
      return this.toResponse(
        await manager.getRepository(PostEntity).save(post),
      );
    });
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
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(PostEntity);
      const post = await repo
        .createQueryBuilder("post")
        .withDeleted()
        .setLock("pessimistic_write")
        .where("post.id = :id", { id })
        .getOne();
      if (!post) throw new NotFoundException("Post not found");
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
      if (!post.deletedAt) {
        return this.toResponse(post);
      }
      await repo.restore(id);
      return this.toResponse(await repo.findOneByOrFail({ id }));
    });
  }

  async getOwnedPost(
    id: string,
    context: AuthenticatedContext,
    withDeleted = false,
  ) {
    const post = await this.postsRepository.findOne({
      where: { id },
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
      location: post.location
        ? {
            latitude: post.location.coordinates[1],
            longitude: post.location.coordinates[0],
          }
        : null,
    };
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
