import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

import { createPaginationMeta } from "../../common/utils/pagination.util";
import { CategoryEntity } from "../categories/category.entity";
import { CreatePostDto } from "./dto/create-post.dto";
import { FindPostsDto } from "./dto/find-posts.dto";
import { UpdatePostDto } from "./dto/update-post.dto";
import { PostEntity, PostStatus } from "./post.entity";

@Injectable()
export class PostsService {
  constructor(
    @InjectRepository(PostEntity)
    private readonly postsRepository: Repository<PostEntity>,
    @InjectRepository(CategoryEntity)
    private readonly categoriesRepository: Repository<CategoryEntity>,
  ) {}

  // Tạo bài viết mới
  async create(dto: CreatePostDto, sellerId: string) {
    await this.ensureCategoryExists(dto.categoryId);

    const post = this.postsRepository.create({
      ...dto,
      sellerId,
    });

    return this.postsRepository.save(post);
  }

  // Lấy danh sách bài viết đang hoạt động
  async findAll(query: FindPostsDto) {
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

  // Lấy chi tiết bài viết public
  async findMyPosts(sellerId: string, query: FindPostsDto) {
    const { page, limit, categoryId } = query;
    const [items, total] = await this.postsRepository.findAndCount({
      where: {
        sellerId,
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

  async findOne(id: string) {
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

    if (!post) {
      throw new NotFoundException("Post not found");
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

  // Cập nhật bài viết
  async update(id: string, dto: UpdatePostDto, requesterId: string) {
    const post = await this.getOwnedPost(id, requesterId);

    if (post.status === PostStatus.HIDDEN) {
      throw new BadRequestException("Hidden posts cannot be updated");
    }

    if (dto.categoryId !== undefined) {
      await this.ensureCategoryExists(dto.categoryId);
    }

    Object.assign(post, dto);

    return this.postsRepository.save(post);
  }

  // Đánh dấu đã bán
  async markAsSold(id: string, requesterId: string) {
    const post = await this.getOwnedPost(id, requesterId);

    if (post.status === PostStatus.HIDDEN) {
      throw new BadRequestException("Hidden posts cannot be marked as sold");
    }

    post.status = PostStatus.SOLD;

    return this.postsRepository.save(post);
  }

  // Xóa mềm bài viết
  async remove(id: string, requesterId: string) {
    await this.getOwnedPost(id, requesterId);

    await this.postsRepository.softDelete(id);
  }

  async restore(id: string, requesterId: string) {
    const post = await this.getOwnedPost(id, requesterId, true);

    if (!post.deletedAt) {
      return post;
    }

    await this.postsRepository.restore(id);
    return this.postsRepository.findOneByOrFail({ id });
  }

  // Kiểm tra quyền sở hữu bài viết
  // Dùng chung cho các module thao tác trên bài đăng, ví dụ PostImagesModule.
  async getOwnedPost(id: string, requesterId: string, withDeleted = false) {
    const post = await this.postsRepository.findOne({
      where: { id },
      withDeleted,
    });

    if (!post) {
      throw new NotFoundException("Post not found");
    }

    if (post.sellerId !== requesterId) {
      throw new ForbiddenException("You do not own this post");
    }

    return post;
  }

  private async ensureCategoryExists(categoryId: string) {
    const category = await this.categoriesRepository.findOneBy({
      id: categoryId,
    });

    if (!category) {
      throw new NotFoundException("Category not found");
    }
  }
}
