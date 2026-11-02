/**
 * MODULE: USERS & HỒ SƠ CÁ NHÂN
 *
 * WORD TEST CASES:
 * - TC-AVA-01: Ký URL PUT avatar vào đúng namespace của user, TTL đúng cấu hình
 * - TC-AVA-02: Từ chối: foreign or malformed keys before contacting storage: avatars/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/cccccccc-cccc-4ccc-8ccc-cccccccccccc.png
 * - TC-AVA-03: Từ chối: foreign or malformed keys before contacting storage: posts/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cccccccc-cccc-4ccc-8ccc-cccccccccccc.png
 * - TC-AVA-04: Từ chối: foreign or malformed keys before contacting storage: messages/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cccccccc-cccc-4ccc-8ccc-cccccccccccc.png
 * - TC-AVA-05: Từ chối: foreign or malformed keys before contacting storage: avatars/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cccccccc-cccc-4ccc-8ccc-cccccccccccc.png/../a
 * - TC-AVA-06: Từ chối: foreign or malformed keys before contacting storage: https://evil.test/a.png
 * - TC-AVA-07: Từ chối: foreign or malformed keys before contacting storage: avatars/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cccccccc-cccc-4ccc-8ccc-cccccccccccc.svg
 * - TC-AVA-08: Từ chối: invalid uploaded metadata: null
 * - TC-AVA-09: Từ chối: invalid uploaded metadata: {"contentLength": 0, "contentType": "image/png"}
 * - TC-AVA-10: Từ chối: invalid uploaded metadata: {"contentLength": 1025, "contentType": "image/png"}
 * - TC-AVA-11: Từ chối: invalid uploaded metadata: {"contentLength": 1.5, "contentType": "image/png"}
 * - TC-AVA-12: Từ chối: invalid uploaded metadata: {"contentLength": 100, "contentType": "image/jpeg"}
 * - TC-AVA-13: Chấp nhận ảnh đúng chủ sở hữu và chuẩn hóa UUID (case-insensitive)
 * - TC-AVA-14: Lỗi storage outage không bị xử lý như object không tồn tại
 * - TC-AVA-15: Validate purpose avatar và các DTO đính kèm (class-validator)
 * - TC-AVA-16: Giữ nguyên URL cũ; không ký URL cho storage key của người khác
 * - TC-AVA-17: Khóa row user (pessimistic write), verify + ký URL trước khi ghi; response không chứa storage key/password
 * - TC-AVA-18: Không update DB when verifyAvatarImage fails
 * - TC-AVA-19: Không update DB when presignGet fails
 * - TC-AVA-20: Từ chối: locked user before touching storage
 * - TC-AVA-21: Từ chối: deleted user before touching storage
 * - TC-AVA-22: Từ chối: foreign user before touching storage
 * - TC-AVA-23: Cập nhật avatar kiểu cũ đồng thời xóa storage key cũ (không để key mồ côi)
 * - TC-AVA-24: Mỗi lần đọc profile tạo URL ký mới (không dùng cache cũ)
 */

import "reflect-metadata";
import { validate } from "class-validator";
import { Repository } from "typeorm";
import { StorageService } from "../../src/modules/storage/storage.service";
import { resolveAvatar } from "../../src/modules/storage/avatar-response";
import { UserService } from "../../src/modules/user/user.service";
import { UserEntity } from "../../src/modules/user/user.entity";
import { UpdateUserDto } from "../../src/modules/user/dto/update-user.dto";
import { UpdateAvatarDto } from "../../src/modules/user/dto/update-avatar.dto";
import { PresignUploadDto } from "../../src/modules/storage/dto/presign-upload.dto";
import { AuthorizationService } from "../../src/modules/authorization/authorization.service";
import { CaslAbilityFactory } from "../../src/modules/authorization/casl-ability.factory";

const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const KEY = `avatars/${OWNER}/cccccccc-cccc-4ccc-8ccc-cccccccccccc.png`;
const authorization = new AuthorizationService(new CaslAbilityFactory());
const context = authorization.createAuthenticatedContext({
  id: OWNER,
  email: "owner@example.com",
  fullName: "Owner",
  isAdmin: false,
});

function makeStorage() {
  return new StorageService(
    {
      endpointUrl: "https://test.r2.cloudflarestorage.com",
      accessKeyId: "test",
      secretAccessKey: "test",
      bucketName: "test",
    },
    {
      maxFileSizeBytes: 1024,
      putSignedUrlExpiresSec: 300,
      getSignedUrlExpiresSec: 900,
    },
    authorization,
  );
}

describe("avatar upload storage", () => {
  let storage: StorageService;
  let head: jest.SpyInstance;
  beforeEach(() => {
    storage = makeStorage();
    head = jest
      .spyOn(storage, "headObject")
      .mockResolvedValue({ contentLength: 100, contentType: "image/png" });
  });
  afterEach(() => jest.restoreAllMocks());

  // [WORD-TC: TC-AVA-01]
  // Chức năng: Ký URL PUT avatar vào đúng namespace của user, TTL đúng cấu hình
  it("[TC-AVA-01] Ký URL PUT avatar vào đúng namespace của user, TTL đúng cấu hình", async () => {
    storage.onModuleInit();
    try {
      const result = await storage.presignPut(
        context,
        "avatar",
        "image/png",
        100,
      );
      expect(StorageService.isAvatarImageKeyOwnedBy(result.key, OWNER)).toBe(
        true,
      );
      expect(result.expiresIn).toBe(300);
      expect(new URL(result.uploadUrl).searchParams.get("X-Amz-Expires")).toBe(
        "300",
      );
    } finally {
      storage.onModuleDestroy();
    }
  });
  // [WORD-TC: TC-AVA-02]
  // Chức năng: Từ chối: foreign or malformed keys before contacting storage: avatars/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/cccccccc-cccc-4ccc-8ccc-cccccccccccc.png
  // [WORD-TC: TC-AVA-03]
  // Chức năng: Từ chối: foreign or malformed keys before contacting storage: posts/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cccccccc-cccc-4ccc-8ccc-cccccccccccc.png
  // [WORD-TC: TC-AVA-04]
  // Chức năng: Từ chối: foreign or malformed keys before contacting storage: messages/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cccccccc-cccc-4ccc-8ccc-cccccccccccc.png
  // [WORD-TC: TC-AVA-05]
  // Chức năng: Từ chối: foreign or malformed keys before contacting storage: avatars/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cccccccc-cccc-4ccc-8ccc-cccccccccccc.png/../a
  // [WORD-TC: TC-AVA-06]
  // Chức năng: Từ chối: foreign or malformed keys before contacting storage: https://evil.test/a.png
  // [WORD-TC: TC-AVA-07]
  // Chức năng: Từ chối: foreign or malformed keys before contacting storage: avatars/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cccccccc-cccc-4ccc-8ccc-cccccccccccc.svg
  it.each([
    KEY.replace(OWNER, OTHER),
    KEY.replace("avatars/", "posts/"),
    KEY.replace("avatars/", "messages/"),
    KEY + "/../a",
    "https://evil.test/a.png",
    KEY.replace(".png", ".svg"),
  ])(
    "[TC-AVA] Từ chối storage key sai định dạng hoặc của người khác: %s",
    async (key) => {
      await expect(storage.verifyAvatarImage(key, OWNER)).rejects.toMatchObject(
        { status: 400 },
      );
      expect(head).not.toHaveBeenCalled();
    },
  );
  // [WORD-TC: TC-AVA-08]
  // Chức năng: Từ chối: invalid uploaded metadata: null
  // [WORD-TC: TC-AVA-09]
  // Chức năng: Từ chối: invalid uploaded metadata: {"contentLength": 0, "contentType": "image/png"}
  // [WORD-TC: TC-AVA-10]
  // Chức năng: Từ chối: invalid uploaded metadata: {"contentLength": 1025, "contentType": "image/png"}
  // [WORD-TC: TC-AVA-11]
  // Chức năng: Từ chối: invalid uploaded metadata: {"contentLength": 1.5, "contentType": "image/png"}
  // [WORD-TC: TC-AVA-12]
  // Chức năng: Từ chối: invalid uploaded metadata: {"contentLength": 100, "contentType": "image/jpeg"}
  it.each([
    null,
    { contentLength: 0, contentType: "image/png" },
    { contentLength: 1025, contentType: "image/png" },
    { contentLength: 1.5, contentType: "image/png" },
    { contentLength: 100, contentType: "image/jpeg" },
  ])("[TC-AVA] Từ chối metadata ảnh tải lên không hợp lệ: %p", async (metadata) => {
    head.mockResolvedValue(metadata);
    await expect(storage.verifyAvatarImage(KEY, OWNER)).rejects.toMatchObject({
      status: 400,
    });
  });
  // [WORD-TC: TC-AVA-13]
  // Chức năng: Chấp nhận ảnh đúng chủ sở hữu và chuẩn hóa UUID (case-insensitive)
  it("[TC-AVA-13] Chấp nhận ảnh đúng chủ sở hữu và chuẩn hóa UUID (case-insensitive)", async () => {
    await expect(
      storage.verifyAvatarImage(KEY, OWNER.toUpperCase()),
    ).resolves.toBeUndefined();
  });
  // [WORD-TC: TC-AVA-14]
  // Chức năng: Lỗi storage outage không bị xử lý như object không tồn tại
  it("[TC-AVA-14] Lỗi storage outage không bị xử lý như object không tồn tại", async () => {
    const failure = new Error("R2 unavailable");
    head.mockRejectedValue(failure);
    await expect(storage.verifyAvatarImage(KEY, OWNER)).rejects.toBe(failure);
  });
  // [WORD-TC: TC-AVA-15]
  // Chức năng: Validate purpose avatar và các DTO đính kèm (class-validator)
  it("[TC-AVA-15] Validate purpose avatar và các DTO đính kèm (class-validator)", async () => {
    expect(
      await validate(
        Object.assign(new PresignUploadDto(), {
          purpose: "avatar",
          contentType: "image/png",
          size: 100,
        }),
      ),
    ).toHaveLength(0);
    expect(
      await validate(Object.assign(new UpdateAvatarDto(), { key: KEY })),
    ).toHaveLength(0);
    expect(
      await validate(
        Object.assign(new UpdateAvatarDto(), { key: "posts/a/b.png" }),
      ),
    ).not.toHaveLength(0);
  });
  // [WORD-TC: TC-AVA-16]
  // Chức năng: Giữ nguyên URL cũ; không ký URL cho storage key của người khác
  it("[TC-AVA-16] Giữ nguyên URL cũ; không ký URL cho storage key của người khác", async () => {
    const signer = { presignGet: jest.fn() };
    await expect(
      resolveAvatar(signer, {
        id: OWNER,
        avatarUrl: "https://legacy.test/a.png",
      }),
    ).resolves.toEqual({ avatarUrl: "https://legacy.test/a.png" });
    await expect(
      resolveAvatar(signer, { id: OTHER, avatarStorageKey: KEY }),
    ).rejects.toMatchObject({ status: 500 });
    expect(signer.presignGet).not.toHaveBeenCalled();
  });
});

describe("attach uploaded avatar to profile", () => {
  let user: UserEntity;
  let repository: {
    findOne: jest.Mock;
    findOneByOrFail: jest.Mock;
    update: jest.Mock;
    manager: { transaction: jest.Mock };
  };
  let storage: StorageService;
  let service: UserService;
  beforeEach(() => {
    user = Object.assign(new UserEntity(), {
      id: OWNER,
      fullName: "Owner",
      email: "owner@example.com",
      isLocked: false,
      deletedAt: null,
      avatarUrl: "https://legacy.test/a.png",
      avatarStorageKey: null,
    });
    repository = {
      findOne: jest.fn().mockImplementation(async () => user),
      findOneByOrFail: jest.fn().mockImplementation(async () => user),
      update: jest.fn().mockImplementation(async (_id, patch) => {
        Object.assign(user, patch);
      }),
      manager: { transaction: jest.fn() },
    };
    repository.manager.transaction.mockImplementation(async (work) =>
      work({ getRepository: () => repository }),
    );
    storage = makeStorage();
    jest.spyOn(storage, "verifyAvatarImage").mockResolvedValue();
    jest.spyOn(storage, "presignGet").mockResolvedValue({
      url: "https://signed.test/a.png",
      expiresAt: "2026-10-11T12:00:00.000Z",
    });
    service = new UserService(
      repository as unknown as Repository<UserEntity>,
      authorization,
      storage,
    );
  });
  afterEach(() => jest.restoreAllMocks());

  // [WORD-TC: TC-AVA-17]
  // Chức năng: Khóa row user (pessimistic write), verify + ký URL trước khi ghi; response không chứa storage key/password
  it("[TC-AVA-17] Khóa row user (pessimistic write), verify + ký URL trước khi ghi; response không chứa storage key/password", async () => {
    const result = await service.updateAvatar({ key: KEY }, context);
    expect(repository.findOne).toHaveBeenCalledWith({
      where: { id: OWNER },
      lock: { mode: "pessimistic_write" },
    });
    expect(storage.verifyAvatarImage).toHaveBeenCalledWith(KEY, OWNER);
    expect(repository.update).toHaveBeenCalledWith(OWNER, {
      avatarStorageKey: KEY,
      avatarUrl: null,
    });
    expect(result.avatarUrl).toBe("https://signed.test/a.png");
    expect(result.avatarUrlExpiresAt).toBe("2026-10-11T12:00:00.000Z");
    expect(result).not.toHaveProperty("avatarStorageKey");
    expect(result).not.toHaveProperty("password");
    expect(storage.presignGet).toHaveBeenCalledTimes(1);
  });
  // [WORD-TC: TC-AVA-18]
  // Chức năng: Không update DB when verifyAvatarImage fails
  // [WORD-TC: TC-AVA-19]
  // Chức năng: Không update DB when presignGet fails
  it.each(["verifyAvatarImage", "presignGet"] as const)(
    "[TC-AVA] Không cập nhật DB khi thao tác %s thất bại",
    async (method) => {
      const failure = new Error("storage failure");
      jest.mocked(storage[method]).mockRejectedValue(failure);
      await expect(service.updateAvatar({ key: KEY }, context)).rejects.toBe(
        failure,
      );
      expect(repository.update).not.toHaveBeenCalled();
    },
  );
  // [WORD-TC: TC-AVA-20]
  // Chức năng: Từ chối: locked user before touching storage
  // [WORD-TC: TC-AVA-21]
  // Chức năng: Từ chối: deleted user before touching storage
  // [WORD-TC: TC-AVA-22]
  // Chức năng: Từ chối: foreign user before touching storage
  it.each(["locked", "deleted", "foreign"])(
    "[TC-AVA] Từ chối người dùng ở trạng thái %s trước khi gọi storage",
    async (state) => {
      if (state === "locked") user.isLocked = true;
      if (state === "deleted") user.deletedAt = new Date();
      if (state === "foreign") user.id = OTHER;
      await expect(
        service.updateAvatar({ key: KEY }, context),
      ).rejects.toThrow();
      expect(storage.verifyAvatarImage).not.toHaveBeenCalled();
      expect(repository.update).not.toHaveBeenCalled();
    },
  );
  // [WORD-TC: TC-AVA-23]
  // Chức năng: Cập nhật avatar kiểu cũ đồng thời xóa storage key cũ (không để key mồ côi)
  it("[TC-AVA-23] Cập nhật avatar kiểu cũ đồng thời xóa storage key cũ (không để key mồ côi)", async () => {
    user.avatarStorageKey = KEY;
    const result = await service.updateMyProfile(
      Object.assign(new UpdateUserDto(), {
        avatarUrl: "https://new.test/a.png",
      }),
      context,
    );
    expect(repository.update).toHaveBeenCalledWith(OWNER, {
      avatarUrl: "https://new.test/a.png",
      avatarStorageKey: null,
    });
    expect(result.avatarUrl).toBe("https://new.test/a.png");
    expect(storage.presignGet).not.toHaveBeenCalled();
  });
  // [WORD-TC: TC-AVA-24]
  // Chức năng: Mỗi lần đọc profile tạo URL ký mới (không dùng cache cũ)
  it("[TC-AVA-24] Mỗi lần đọc profile tạo URL ký mới (không dùng cache cũ)", async () => {
    user.avatarStorageKey = KEY;
    expect((await service.getMyProfile(context)).avatarUrl).toBe(
      "https://signed.test/a.png",
    );
    expect((await service.getMyProfile(context)).avatarUrl).toBe(
      "https://signed.test/a.png",
    );
    expect(storage.presignGet).toHaveBeenCalledTimes(2);
  });
});
