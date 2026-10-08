import { ConflictException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { QueryFailedError, Repository } from "typeorm";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { createPaginationMeta } from "../../common/utils/pagination.util";
import { PostStatus } from "../posts/post.entity";
import { PostsService } from "../posts/posts.service";
import { FavoriteEntity } from "./favorite.entity";
import { AuthorizationService } from "../authorization/authorization.service";
import type { AuthenticatedContext } from "../authorization/authorization.types";

@Injectable()
export class FavoritesService {
  constructor(
    @InjectRepository(FavoriteEntity)
    private readonly favoritesRepository: Repository<FavoriteEntity>,
    private readonly postsService: PostsService,
    private readonly authorization: AuthorizationService,
  ) {}

  async create(context: AuthenticatedContext, postId: string) {
    const userId = context.principal.id;
    this.authorization.assertCreate(context, "Favorite", {
      userId,
      postId,
    });
    await this.postsService.getActivePost(postId);
    const favorite = this.favoritesRepository.create({ userId, postId });
    try {
      const saved = await this.favoritesRepository.save(favorite);
      return { id: saved.id, postId: saved.postId, createdAt: saved.createdAt };
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        error.driverError.code === "23505" &&
        error.driverError.constraint === "uq_favorites_user_post"
      ) {
        throw new ConflictException("Post is already in your favorites");
      }
      throw error;
    }
  }

  async remove(context: AuthenticatedContext, postId: string) {
    const userId = context.principal.id;
    this.authorization.assertRoute(context, "delete", "Favorite");
    await this.favoritesRepository.delete({ userId, postId });
    return { postId };
  }

  async findAll(context: AuthenticatedContext, query: PaginationDto) {
    const userId = context.principal.id;
    this.authorization.assertRoute(context, "read", "Favorite");
    const [favorites, total] = await this.favoritesRepository
      .createQueryBuilder("favorite")
      .innerJoinAndSelect("favorite.post", "post")
      .leftJoin("post.seller", "seller")
      .addSelect(["seller.id", "seller.fullName", "seller.avatarUrl"])
      .leftJoin("post.category", "category")
      .addSelect(["category.id", "category.name"])
      .leftJoinAndSelect("post.images", "image")
      .where("favorite.userId = :userId", { userId })
      .andWhere("post.deletedAt IS NULL")
      .andWhere("post.status IN (:...statuses)", {
        statuses: [PostStatus.ACTIVE, PostStatus.SOLD],
      })
      .orderBy("favorite.createdAt", "DESC")
      .addOrderBy("favorite.id", "DESC")
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();

    return {
      items: favorites.map((favorite) => ({
        id: favorite.id,
        postId: favorite.postId,
        createdAt: favorite.createdAt,
        post: favorite.post,
      })),
      meta: createPaginationMeta(query, total),
    };
  }
}
