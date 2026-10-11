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

  it("signs an authenticated avatar PUT into its own namespace", async () => {
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
  it.each([
    KEY.replace(OWNER, OTHER),
    KEY.replace("avatars/", "posts/"),
    KEY.replace("avatars/", "messages/"),
    KEY + "/../a",
    "https://evil.test/a.png",
    KEY.replace(".png", ".svg"),
  ])(
    "rejects foreign or malformed keys before contacting storage: %s",
    async (key) => {
      await expect(storage.verifyAvatarImage(key, OWNER)).rejects.toMatchObject(
        { status: 400 },
      );
      expect(head).not.toHaveBeenCalled();
    },
  );
  it.each([
    null,
    { contentLength: 0, contentType: "image/png" },
    { contentLength: 1025, contentType: "image/png" },
    { contentLength: 1.5, contentType: "image/png" },
    { contentLength: 100, contentType: "image/jpeg" },
  ])("rejects invalid uploaded metadata: %p", async (metadata) => {
    head.mockResolvedValue(metadata);
    await expect(storage.verifyAvatarImage(KEY, OWNER)).rejects.toMatchObject({
      status: 400,
    });
  });
  it("accepts an owned uploaded image and normalizes principal UUID", async () => {
    await expect(
      storage.verifyAvatarImage(KEY, OWNER.toUpperCase()),
    ).resolves.toBeUndefined();
  });
  it("does not turn storage outages into missing objects", async () => {
    const failure = new Error("R2 unavailable");
    head.mockRejectedValue(failure);
    await expect(storage.verifyAvatarImage(KEY, OWNER)).rejects.toBe(failure);
  });
  it("validates avatar purpose and attachment DTO", async () => {
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
  it("preserves legacy URLs and does not sign foreign stored keys", async () => {
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

  it("locks the account, verifies and signs before writing; returns no key or password", async () => {
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
  it.each(["verifyAvatarImage", "presignGet"] as const)(
    "does not update DB when %s fails",
    async (method) => {
      const failure = new Error("storage failure");
      jest.mocked(storage[method]).mockRejectedValue(failure);
      await expect(service.updateAvatar({ key: KEY }, context)).rejects.toBe(
        failure,
      );
      expect(repository.update).not.toHaveBeenCalled();
    },
  );
  it.each(["locked", "deleted", "foreign"])(
    "rejects %s user before touching storage",
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
  it("supports legacy avatar updates without leaving a stale storage key", async () => {
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
  it("fetches a fresh signed URL on profile reads", async () => {
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
