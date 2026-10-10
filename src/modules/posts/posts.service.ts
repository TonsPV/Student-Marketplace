import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Brackets, DataSource, EntityManager, Repository } from "typeorm";

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
      location: dto.location,
      sellerId: context.principal.id,
    });

    return this.postsRepository.save(post);
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
      items,
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
      items,
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
      .addSelect(["seller.id", "seller.fullName", "seller.avatarUrl"])
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

    const items = entities.map((post, index) => ({
      ...post,
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
      where: {
        id,
        status: PostStatus.ACTIVE,
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

    return post;
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
      Object.assign(post, effective);
      return manager.getRepository(PostEntity).save(post);
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
      return manager.getRepository(PostEntity).save(post);
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
        return post;
      }
      await repo.restore(id);
      return repo.findOneByOrFail({ id });
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
