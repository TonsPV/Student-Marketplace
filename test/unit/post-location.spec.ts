import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { DataSource, Repository } from "typeorm";
import { AuthorizationService } from "../../src/modules/authorization/authorization.service";
import { CaslAbilityFactory } from "../../src/modules/authorization/casl-ability.factory";
import { CategoryEntity } from "../../src/modules/categories/category.entity";
import { CreatePostDto } from "../../src/modules/posts/dto/create-post.dto";
import { UpdatePostDto } from "../../src/modules/posts/dto/update-post.dto";
import {
  PostEntity,
  PostCondition,
  PostStatus,
} from "../../src/modules/posts/post.entity";
import { PostsService } from "../../src/modules/posts/posts.service";
import { StorageService } from "../../src/modules/storage/storage.service";
import { UserEntity } from "../../src/modules/user/user.entity";

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const categoryId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const location = { latitude: 10.7769, longitude: 106.7009 };
const authorization = new AuthorizationService(new CaslAbilityFactory());
const context = authorization.createAuthenticatedContext({
  id,
  email: "me@example.test",
  fullName: "Me",
  isAdmin: false,
});
const body = {
  categoryId,
  title: "Sách Giải tích",
  description: "Sách còn tốt, có ghi chú bằng bút chì.",
  price: "50000",
  condition: PostCondition.GOOD,
};
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});

describe("post location API contract", () => {
  let post: PostEntity;
  let repo: Record<string, jest.Mock>;
  let service: PostsService;
  beforeEach(() => {
    post = Object.assign(new PostEntity(), {
      ...body,
      id,
      sellerId: id,
      status: PostStatus.ACTIVE,
      deletedAt: null,
      location: { type: "Point", coordinates: [106.7009, 10.7769] },
    });
    const query: Record<string, jest.Mock> = {};
    for (const method of ["setLock", "where", "withDeleted"])
      query[method] = jest.fn().mockReturnValue(query);
    query.getOne = jest.fn().mockImplementation(async () => post);
    query.getOneOrFail = jest.fn().mockImplementation(async () => post);
    repo = {
      create: jest
        .fn()
        .mockImplementation((value) => Object.assign(new PostEntity(), value)),
      save: jest.fn().mockImplementation(async (value) => value),
      findAndCount: jest.fn().mockImplementation(async () => [[post], 1]),
      createQueryBuilder: jest.fn().mockReturnValue(query),
      restore: jest.fn(),
      countBy: jest.fn().mockResolvedValue(0),
      findOne: jest.fn().mockImplementation(async () => post),
      findOneByOrFail: jest.fn().mockImplementation(async () => post),
    };
    service = new PostsService(
      repo as unknown as Repository<PostEntity>,
      {
        findOneBy: jest.fn().mockResolvedValue({ id: categoryId }),
      } as unknown as Repository<CategoryEntity>,
      authorization,
      {
        getRepository: () => ({
          createQueryBuilder: () => {
            const images: Record<string, jest.Mock> = {};
            for (const method of [
              "select",
              "distinctOn",
              "where",
              "andWhere",
              "orderBy",
              "addOrderBy",
            ])
              images[method] = jest.fn().mockReturnValue(images);
            images.getMany = jest.fn().mockResolvedValue([]);
            return images;
          },
        }),
        transaction: async (
          fnOrIsolation: string | ((manager: unknown) => unknown),
          work?: (manager: unknown) => unknown,
        ) =>
          (work ?? (fnOrIsolation as (manager: unknown) => unknown))({
            query: async () => [{ now: new Date() }],
            getRepository: (entity: unknown) =>
              entity === UserEntity
                ? {
                    createQueryBuilder: () => ({
                      setLock: () => ({
                        where: () => ({
                          getOne: async () => ({ id, isLocked: false }),
                        }),
                      }),
                    }),
                  }
                : entity === CategoryEntity
                  ? { findOneBy: async () => ({ id: categoryId }) }
                  : repo,
          }),
      } as unknown as DataSource,
      {} as StorageService,
    );
  });

  it.each([CreatePostDto, UpdatePostDto])(
    "validates named coordinates in %p",
    async (metatype) => {
      const payload = metatype === CreatePostDto ? body : {};
      for (const point of [
        location,
        { latitude: 0, longitude: 0 },
        { latitude: -90, longitude: 180 },
        null,
      ]) {
        const dto = await pipe.transform(
          { ...payload, location: point },
          { type: "body", metatype },
        );
        expect(dto.location).toEqual(point);
      }
      for (const point of [
        { latitude: 91, longitude: 106 },
        { latitude: 10, longitude: -181 },
        { latitude: "10", longitude: 106 },
        { latitude: 10 },
        {},
        { type: "Point", coordinates: [106, 10] },
        { ...location, extra: true },
      ]) {
        await expect(
          pipe.transform(
            { ...payload, location: point },
            { type: "body", metatype },
          ),
        ).rejects.toThrow();
      }
    },
  );

  it("creates DB GeoJSON in longitude/latitude order and returns named coordinates", async () => {
    const result = await service.create({ ...body, location }, context);
    expect(repo.save.mock.calls[0][0].location).toEqual({
      type: "Point",
      coordinates: [106.7009, 10.7769],
    });
    expect(result.location).toEqual(location);
    expect((await service.create(body, context)).location).toBeNull();
  });

  it("authorizes nested fields and updates, preserves or clears stored location", async () => {
    const next = { latitude: 0, longitude: 0 };
    expect(
      (await service.update(id, { location: next }, context)).location,
    ).toEqual(next);
    expect(post.location).toEqual({ type: "Point", coordinates: [0, 0] });
    expect(
      (await service.update(id, { title: "Sách đã cập nhật" }, context))
        .location,
    ).toEqual(next);
    expect(
      (await service.update(id, { location: null }, context)).location,
    ).toBeNull();
    expect(post.location).toBeNull();
  });

  it("serializes lists, favorites projection, sold and restore without mutating DB entities", async () => {
    expect(
      (await service.findAll({ page: 1, limit: 10 }, context)).items[0]
        .location,
    ).toEqual(location);
    expect(
      (await service.findMyPosts(context, { page: 1, limit: 10 })).items[0]
        .location,
    ).toEqual(location);
    expect((await service.withSellerAvatar(post)).location).toEqual(location);
    expect((await service.markAsSold(id, context)).location).toEqual(location);
    expect((await service.restore(id, context)).location).toEqual(location);
    post.deletedAt = new Date();
    expect((await service.restore(id, context)).location).toEqual(location);
    expect(post.location).toEqual({
      type: "Point",
      coordinates: [106.7009, 10.7769],
    });
  });

  it("rejects malformed coordinates even for direct service callers", async () => {
    for (const point of [
      { latitude: NaN, longitude: 106 },
      { latitude: 10, longitude: Infinity },
      { latitude: 91, longitude: 106 },
      { type: "Point", coordinates: [106, 10] },
    ]) {
      await expect(
        service.create(
          { ...body, location: point } as unknown as CreatePostDto,
          context,
        ),
      ).rejects.toThrow();
    }
    expect(repo.save).not.toHaveBeenCalled();
  });
});
