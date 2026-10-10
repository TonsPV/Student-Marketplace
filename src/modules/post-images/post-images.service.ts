import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { isURL } from "class-validator";
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
import {
  StorageService,
  type PresignedGetResult,
} from "../storage/storage.service";

@Injectable()
export class PostImagesService {
  constructor(
    @InjectRepository(PostImageEntity)
    private readonly imagesRepository: Repository<PostImageEntity>,
    private readonly postsService: PostsService,
    private readonly authorization: AuthorizationService,
    private readonly dataSource: DataSource,
    private readonly storage: StorageService,
  ) {}

  async create(
    postId: string,
    dto: CreatePostImageDto,
    context: AuthenticatedContext,
  ) {
    const input = this.authorization.effectivePatch({ ...dto });
    if (
      Object.keys(input).some((field) => field !== "key" && field !== "url") ||
      (typeof dto.key === "string") === (typeof dto.url === "string") ||
      (dto.key !== undefined && typeof dto.key !== "string") ||
      (dto.url !== undefined && typeof dto.url !== "string")
    ) {
      throw new BadRequestException("Provide exactly one image key or URL");
    }
    if (
      dto.url !== undefined &&
      (dto.url.length > 2048 || !isURL(dto.url, { require_protocol: true }))
    ) {
      throw new BadRequestException("Invalid image URL");
    }
    // Authorize before any storage call, then recheck under the post row lock.
    await this.postsService.getPostForAction(postId, context, "manageImages");
    let signed: PresignedGetResult | undefined;
    if (dto.key !== undefined) {
      await this.storage.verifyPostImage(dto.key, context.principal.id);
      signed = await this.storage.presignGet(dto.key);
    }
    return this.dataSource.transaction(async (manager) => {
      await this.postsService.getPostForAction(
        postId,
        context,
        "manageImages",
        false,
        manager,
      );
      const repo = manager.getRepository(PostImageEntity);
      const image = await repo.save(
        repo.create({
          postId,
          url: dto.url ?? null,
          storageKey: dto.key ?? null,
        }),
      );
      return this.toResponse(image, signed);
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

    const images = await this.imagesRepository.find({
      where: { postId },
      order: { id: "ASC" },
    });
    return Promise.all(
      images.map(async (image) =>
        this.toResponse(
          image,
          image.storageKey
            ? await this.storage.presignGet(image.storageKey)
            : undefined,
        ),
      ),
    );
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

  private toResponse(image: PostImageEntity, signed?: PresignedGetResult) {
    return {
      id: image.id,
      postId: image.postId,
      url: signed?.url ?? image.url,
      ...(signed ? { urlExpiresAt: signed.expiresAt } : {}),
    };
  }
}
