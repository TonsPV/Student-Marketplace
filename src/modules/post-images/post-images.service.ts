import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PostEntity, PostStatus } from '../posts/post.entity';
import { CreatePostImageDto } from './dto/create-post-image.dto';
import { PostImageEntity } from './post-image.entity';

@Injectable()
export class PostImagesService {
  constructor(
    @InjectRepository(PostImageEntity)
    private readonly imagesRepository: Repository<PostImageEntity>,
    @InjectRepository(PostEntity)
    private readonly postsRepository: Repository<PostEntity>,
  ) {}

  async create(postId: string, dto: CreatePostImageDto, requesterId: string) {
    await this.getOwnedPost(postId, requesterId);
    const image = this.imagesRepository.create({ postId, url: dto.url });
    return this.imagesRepository.save(image);
  }

  async findAll(postId: string) {
    const post = await this.postsRepository.findOne({
      where: { id: postId, status: PostStatus.ACTIVE },
    });
    if (!post) throw new NotFoundException('Post not found');

    return this.imagesRepository.find({
      where: { postId },
      order: { id: 'ASC' },
    });
  }

  async remove(postId: string, imageId: string, requesterId: string) {
    await this.getOwnedPost(postId, requesterId);
    const image = await this.imagesRepository.findOne({
      where: { id: imageId, postId },
    });
    if (!image) throw new NotFoundException('Post image not found');

    await this.imagesRepository.remove(image);
  }

  private async getOwnedPost(postId: string, requesterId: string) {
    const post = await this.postsRepository.findOne({ where: { id: postId } });
    if (!post) throw new NotFoundException('Post not found');
    if (post.sellerId !== requesterId) {
      throw new ForbiddenException('You do not own this post');
    }
    return post;
  }
}
