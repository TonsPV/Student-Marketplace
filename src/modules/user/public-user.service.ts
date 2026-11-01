import { Injectable, NotFoundException } from "@nestjs/common";
import { DataSource, Raw } from "typeorm";
import { UserEntity } from "./user.entity";
import { PostEntity, PostStatus } from "../posts/post.entity";
import { resolveAvatar } from "../storage/avatar-response";
import { StorageService } from "../storage/storage.service";
import { sellerStatistics } from "../reviews/seller-statistics";
import { PublicUserPostsDto } from "./dto/public-user-posts.dto";
import { createPaginationMeta } from "../../common/utils/pagination.util";
import { AuthorizationService } from "../authorization/authorization.service";
import type { AuthorizationContext } from "../authorization/authorization.types";

@Injectable()
export class PublicUserService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly storage: StorageService,
    private readonly authorization: AuthorizationService,
  ) {}

  private async readableUser(id: string) {
    const user = await this.dataSource.getRepository(UserEntity).findOne({
      where: { id, isLocked: false },
      select: {
        id: true,
        fullName: true,
        university: true,
        createdAt: true,
        avatarUrl: true,
        avatarStorageKey: true,
      },
    });
    if (!user) throw new NotFoundException("User not found");
    return user;
  }

  async profile(id: string) {
    const user = await this.readableUser(id);
    const [avatar, stats] = await Promise.all([
      resolveAvatar(this.storage, user),
      sellerStatistics(this.dataSource, id),
    ]);
    return {
      id: user.id,
      fullName: user.fullName,
      university: user.university,
      createdAt: user.createdAt,
      ...avatar,
      ...stats,
    };
  }

  async posts(
    id: string,
    query: PublicUserPostsDto,
    context: AuthorizationContext,
  ) {
    this.authorization.assertRoute(context, "read", "Post");
    await this.readableUser(id);
    const [items, total] = await this.dataSource
      .getRepository(PostEntity)
      .findAndCount({
        where: (query.status
          ? [query.status]
          : [PostStatus.ACTIVE, PostStatus.SOLD]
        ).map((status) => ({
          sellerId: id,
          status,
          ...(status === PostStatus.ACTIVE
            ? { expiresAt: Raw((alias) => `${alias} > statement_timestamp()`) }
            : {}),
        })),
        relations: { category: true },
        select: { category: { id: true, name: true } },
        order: { createdAt: "DESC", id: "DESC" },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      });
    return { items, meta: createPaginationMeta(query, total) };
  }
}
