import "reflect-metadata";
import { DataSource, Repository } from "typeorm";
import { AuthorizationService } from "../../src/modules/authorization/authorization.service";
import { CaslAbilityFactory } from "../../src/modules/authorization/casl-ability.factory";
import { CategoryEntity } from "../../src/modules/categories/category.entity";
import { PostEntity, PostStatus } from "../../src/modules/posts/post.entity";
import { PostsService } from "../../src/modules/posts/posts.service";
import { PostImageEntity } from "../../src/modules/post-images/post-image.entity";
import { StorageService } from "../../src/modules/storage/storage.service";
import { ModerationService } from "../../src/modules/moderation/moderation.service";

describe("post list covers", () => {
  const authorization = new AuthorizationService(new CaslAbilityFactory());
  const context = authorization.createGuestContext();
  let posts: PostEntity[];
  let images: PostImageEntity[];
  let query: Record<string, jest.Mock>;
  let getRepository: jest.Mock;
  let presignGet: jest.Mock;
  let service: PostsService;

  beforeEach(() => {
    posts = Array.from({ length: 10 }, (_, index) =>
      Object.assign(new PostEntity(), {
        id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, "0")}`,
        status: PostStatus.ACTIVE,
        location: null,
      }),
    );
    images = [
      Object.assign(new PostImageEntity(), {
        postId: posts[0].id,
        storageKey: "posts/owner/cover.jpg",
        url: null,
      }),
      Object.assign(new PostImageEntity(), {
        postId: posts[1].id,
        storageKey: null,
        url: "https://example.test/legacy.jpg",
      }),
    ];
    query = {};
    for (const method of [
      "select",
      "distinctOn",
      "where",
      "orderBy",
      "addOrderBy",
    ])
      query[method] = jest.fn().mockReturnValue(query);
    query.getMany = jest.fn().mockImplementation(async () => images);
    getRepository = jest
      .fn()
      .mockReturnValue({ createQueryBuilder: () => query });
    presignGet = jest.fn().mockResolvedValue({
      url: "https://example.test/signed.jpg?signature=cover",
      expiresAt: "2026-10-18T00:00:00Z",
    });
    service = new PostsService(
      {
        findAndCount: jest
          .fn()
          .mockImplementation(async () => [posts, posts.length]),
      } as unknown as Repository<PostEntity>,
      {} as Repository<CategoryEntity>,
      authorization,
      { getRepository } as unknown as DataSource,
      { presignGet } as unknown as StorageService,
      {} as ModerationService,
    );
  });

  it("loads ten covers with one query and signs only selected storage images", async () => {
    const result = await service.findAll({ page: 1, limit: 10 }, context);
    expect(result.items).toHaveLength(10);
    expect(getRepository).toHaveBeenCalledTimes(1);
    expect(getRepository).toHaveBeenCalledWith(PostImageEntity);
    expect(query.getMany).toHaveBeenCalledTimes(1);
    expect(query.where).toHaveBeenCalledWith("image.postId IN (:...postIds)", {
      postIds: posts.map((post) => post.id),
    });
    expect(query.distinctOn).toHaveBeenCalledWith(["image.postId"]);
    expect(query.orderBy).toHaveBeenCalledWith("image.postId", "ASC");
    expect(query.addOrderBy).toHaveBeenCalledWith("image.id", "ASC");
    expect(presignGet).toHaveBeenCalledTimes(1);
    expect(result.items[0]).toMatchObject({
      thumbnailUrl: "https://example.test/signed.jpg?signature=cover",
      thumbnailUrlExpiresAt: "2026-10-18T00:00:00Z",
    });
    expect(result.items[1].thumbnailUrl).toBe(
      "https://example.test/legacy.jpg",
    );
    expect(result.items[2].thumbnailUrl).toBeNull();
    expect(JSON.stringify(result)).not.toContain("storageKey");
  });

  it("does no cover query for an empty page", async () => {
    posts = [];
    expect(
      (await service.findAll({ page: 1, limit: 10 }, context)).items,
    ).toEqual([]);
    expect(getRepository).not.toHaveBeenCalled();
    expect(presignGet).not.toHaveBeenCalled();
  });

  it("keeps posts readable when a cover cannot be signed", async () => {
    presignGet.mockRejectedValue(new Error("Storage signing unavailable"));
    const result = await service.findAll({ page: 1, limit: 10 }, context);
    expect(result.items).toHaveLength(10);
    expect(result.items[0].thumbnailUrl).toBeNull();
    expect(result.items[0]).not.toHaveProperty("thumbnailUrlExpiresAt");
    expect(result.items[1].thumbnailUrl).toBe(
      "https://example.test/legacy.jpg",
    );
  });
});
