import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CreatePostDto } from './dto/create-post.dto';
import { FindPostsDto } from './dto/find-posts.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { PostEntity, PostStatus } from './post.entity';

@Injectable()
export class PostsService {
  constructor(
    @InjectRepository(PostEntity)
    private readonly postsRepository: Repository<PostEntity>,
  ) {}

  // Tạo bài viết mới
  async create(dto: CreatePostDto, sellerId: string) {
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
      },
      select: {
        seller: {
          id: true,
          fullName: true,
          avatarUrl: true,
        },
      },
      order: {
        createdAt: 'DESC',
      },
      skip: (page - 1) * limit,
      take: limit,
    });

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

  // Lấy chi tiết bài viết public
  async findMyPosts(sellerId: string, query: FindPostsDto) {
    const { page, limit, categoryId } = query;
    const [items, total] = await this.postsRepository.findAndCount({
      where: {
        sellerId,
        ...(categoryId ? { categoryId } : {}),
      },
      order: {
        createdAt: 'DESC',
      },
      skip: (page - 1) * limit,
      take: limit,
    });

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

  async findOne(id: string) {
    const post = await this.postsRepository.findOne({
      where: {
        id,
        status: PostStatus.ACTIVE,
      },
      relations: {
        seller: true,
      },
      select: {
        seller: {
          id: true,
          fullName: true,
          avatarUrl: true,
        },
      },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    return post;
  }

  // Cập nhật bài viết
  async update(
    id: string,
    dto: UpdatePostDto,
    requesterId: string,
  ) {
    const post = await this.getOwnedPost(id, requesterId);

    Object.assign(post, dto);

    return this.postsRepository.save(post);
  }

  // Đánh dấu đã bán
  async markAsSold(id: string, requesterId: string) {
    const post = await this.getOwnedPost(id, requesterId);

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
  private async getOwnedPost(
    id: string,
    requesterId: string,
    withDeleted = false,
  ) {
    const post = await this.postsRepository.findOne({
      where: { id },
      withDeleted,
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    if (post.sellerId !== requesterId) {
      throw new ForbiddenException('You do not own this post');
    }

    return post;
  }
}
