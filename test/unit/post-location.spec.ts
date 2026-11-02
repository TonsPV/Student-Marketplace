/**
 * MODULE: POSTS (VÒNG ĐỜI TIN ĐĂNG)
 *
 * WORD TEST CASES:
 * - TC-PLO-01: Kiểm tra hợp lệ: named coordinates in [Function CreatePostDto]
 * - TC-PLO-02: Kiểm tra hợp lệ: named coordinates in [Function UpdatePostDto]
 * - TC-PLO-03: Tạo GeoJSON DB đúng thứ tự kinh độ–vĩ độ và trả về tọa độ có tên
 * - TC-PLO-04: Phân quyền field lồng nhau; cập nhật/giữ nguyên/xóa location đã lưu đúng ý định
 * - TC-PLO-05: Serialize danh sách/tin bán/restore không làm thay đổi entity DB (không mutation)
 * - TC-PLO-06: Từ chối: malformed coordinates even for direct service callers
 */

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
import { ModerationService } from "../../src/modules/moderation/moderation.service";

const allowPosting = {
  getActivePostingRestrictions: jest.fn().mockResolvedValue([]),
  lockPostingUser: jest.fn().mockResolvedValue(new Date()),
  assertCanPost: jest.fn().mockResolvedValue(undefined),
  lockAndAssertCanPost: jest.fn().mockResolvedValue(undefined),
} as unknown as ModerationService;

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
    // Universal chainable QueryBuilder stub: the Phase 4 listing path
    // (findAll) and the transaction flows (update/markAsSold/restore) share
    // this repository mock, so every chained method must return the builder.
    const query: Record<string, jest.Mock> = new Proxy(
      {} as Record<string, jest.Mock>,
      {
        get(target, prop: string) {
          if (prop === "getOne")
            return (target[prop] ??= jest
              .fn()
              .mockImplementation(async () => post));
          if (prop === "getCount")
            return (target[prop] ??= jest.fn(async () => 1));
          if (prop === "getRawAndEntities")
            return (target[prop] ??= jest.fn(
              async () => ({ entities: [post], raw: [{}] }) as unknown,
            ));
          if (prop === "clone") return (target[prop] ??= jest.fn(() => query));
          return (target[prop] ??= jest.fn().mockReturnValue(query));
        },
      },
    );
    repo = {
      countBy: jest.fn(async () => 0),
      create: jest
        .fn()
        .mockImplementation((value) => Object.assign(new PostEntity(), value)),
      save: jest.fn().mockImplementation(async (value) => value),
      findAndCount: jest.fn().mockImplementation(async () => [[post], 1]),
      createQueryBuilder: jest.fn().mockReturnValue(query),
      restore: jest.fn(),
      update: jest.fn(async () => ({})),
      findOneByOrFail: jest.fn().mockImplementation(async () => post),
      findOne: jest.fn().mockImplementation(async () => post),
      findOneBy: jest.fn().mockResolvedValue({ id: categoryId }),
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
        // Supports both transaction(fn) and transaction(isolation, fn).
        transaction: async (...args: unknown[]) =>
          (args[args.length - 1] as (manager: unknown) => unknown)({
            getRepository: () => repo,
            query: async () => [{ now: new Date() }],
          }),
      } as unknown as DataSource,
      {} as StorageService,
      allowPosting,
    );
  });

  // [WORD-TC: TC-PLO-01]
  // Chức năng: Kiểm tra hợp lệ: named coordinates in [Function CreatePostDto]
  // [WORD-TC: TC-PLO-02]
  // Chức năng: Kiểm tra hợp lệ: named coordinates in [Function UpdatePostDto]
  it.each([CreatePostDto, UpdatePostDto])(
    "[TC-PLO] Kiểm tra hợp lệ tọa độ vị trí trong DTO %p",
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

  // [WORD-TC: TC-PLO-03]
  // Chức năng: Tạo GeoJSON DB đúng thứ tự kinh độ–vĩ độ và trả về tọa độ có tên
  it("[TC-PLO-03] Tạo GeoJSON DB đúng thứ tự kinh độ–vĩ độ và trả về tọa độ có tên", async () => {
    const result = await service.create({ ...body, location }, context);
    expect(repo.save.mock.calls[0][0].location).toEqual({
      type: "Point",
      coordinates: [106.7009, 10.7769],
    });
    expect(result.location).toEqual(location);
    expect((await service.create(body, context)).location).toBeNull();
  });

  // [WORD-TC: TC-PLO-04]
  // Chức năng: Phân quyền field lồng nhau; cập nhật/giữ nguyên/xóa location đã lưu đúng ý định
  it("[TC-PLO-04] Phân quyền field lồng nhau; cập nhật/giữ nguyên/xóa location đã lưu đúng ý định", async () => {
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

  // [WORD-TC: TC-PLO-05]
  // Chức năng: Serialize danh sách/tin bán/restore không làm thay đổi entity DB (không mutation)
  it("[TC-PLO-05] Serialize danh sách/tin bán/restore không làm thay đổi entity DB (không mutation)", async () => {
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

  // [WORD-TC: TC-PLO-06]
  // Chức năng: Từ chối: malformed coordinates even for direct service callers
  it("[TC-PLO-06] Từ chối: malformed coordinates even for direct service callers", async () => {
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
jest.mock("../../src/modules/moderation/reputation-posting-policy", () => ({
  sellerPostingReputation: jest
    .fn()
    .mockResolvedValue({ blocked: false, warning: false, reason: null }),
}));
