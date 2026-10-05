import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { PostsService } from "../posts/posts.service";
import { CreatePostImageDto } from "./dto/create-post-image.dto";
import { PostImageEntity } from "./post-image.entity";

@Injectable()
export class PostImagesService {
  constructor(
    @InjectRepository(PostImageEntity)
    private readonly imagesRepository: Repository<PostImageEntity>,
    private readonly postsService: PostsService,
  ) {}

  async create(postId: string, dto: CreatePostImageDto, requesterId: string) {
    await this.postsService.getOwnedPost(postId, requesterId);
    const image = this.imagesRepository.create({ postId, url: dto.url });
    return this.imagesRepository.save(image);
  }

  async findAll(postId: string) {
    await this.postsService.getActivePost(postId);

    return this.imagesRepository.find({
      where: { postId },
      order: { id: "ASC" },
    });
  }

  async remove(postId: string, imageId: string, requesterId: string) {
    await this.postsService.getOwnedPost(postId, requesterId);
    const image = await this.imagesRepository.findOne({
      where: { id: imageId, postId },
    });
    if (!image) throw new NotFoundException("Post image not found");

    await this.imagesRepository.remove(image);
  }
}
