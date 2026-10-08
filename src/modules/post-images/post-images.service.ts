import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import { PostsService } from "../posts/posts.service";
import { CreatePostImageDto } from "./dto/create-post-image.dto";
import { PostImageEntity } from "./post-image.entity";
import { AuthorizationService } from "../authorization/authorization.service";
import type {
  AuthenticatedContext,
  AuthorizationContext,
} from "../authorization/authorization.types";
import { toPostProjection } from "../authorization/subject-projections";

@Injectable()
export class PostImagesService {
  constructor(
    @InjectRepository(PostImageEntity)
    private readonly imagesRepository: Repository<PostImageEntity>,
    private readonly postsService: PostsService,
    private readonly authorization: AuthorizationService,
    private readonly dataSource: DataSource,
  ) {}

  async create(
    postId: string,
    dto: CreatePostImageDto,
    context: AuthenticatedContext,
  ) {
    return this.dataSource.transaction(async (manager) => {
      await this.postsService.getPostForAction(
        postId,
        context,
        "manageImages",
        false,
        manager,
      );
      const repo = manager.getRepository(PostImageEntity);
      return repo.save(repo.create({ postId, url: dto.url }));
    });
  }

  async findAll(postId: string, context: AuthorizationContext) {
    const post = await this.postsService.getActivePost(postId);
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

    return this.imagesRepository.find({
      where: { postId },
      order: { id: "ASC" },
    });
  }

  async remove(postId: string, imageId: string, context: AuthenticatedContext) {
    await this.dataSource.transaction(async (manager) => {
      await this.postsService.getPostForAction(
        postId,
        context,
        "manageImages",
        false,
        manager,
      );
      const repo = manager.getRepository(PostImageEntity);
      const image = await repo.findOneBy({ id: imageId, postId });
      if (!image) throw new NotFoundException("Post image not found");
      await repo.remove(image);
    });
  }
}
