import "reflect-metadata";
import { Repository } from "typeorm";
import { AuthorizationService } from "../../src/modules/authorization/authorization.service";
import { CaslAbilityFactory } from "../../src/modules/authorization/casl-ability.factory";
import { UserEntity } from "../../src/modules/user/user.entity";
import { UserService } from "../../src/modules/user/user.service";
import { StorageService } from "../../src/modules/storage/storage.service";
import { UpdateUserDto } from "../../src/modules/user/dto/update-user.dto";

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const authorization = new AuthorizationService(new CaslAbilityFactory());
const context = authorization.createAuthenticatedContext({
  id: ID,
  email: "me@example.com",
  fullName: "Me",
  isAdmin: false,
});

describe("personal profile fields", () => {
  let user: UserEntity;
  let repository: { findOne: jest.Mock; update: jest.Mock };
  let service: UserService;
  beforeEach(() => {
    user = Object.assign(new UserEntity(), {
      id: ID,
      email: "me@example.com",
      fullName: "Me",
      password: "private-hash",
      isLocked: false,
      deletedAt: null,
      isAdmin: true,
      location: { type: "Point", coordinates: [106.7009, 10.7769] },
      avatarStorageKey: null,
      avatarUrl: null,
    });
    repository = {
      findOne: jest.fn().mockResolvedValue(user),
      update: jest.fn(),
    };
    service = new UserService(
      repository as unknown as Repository<UserEntity>,
      authorization,
      {} as StorageService,
    );
  });

  it("returns DB admin flag and converts longitude/latitude from GeoJSON", async () => {
    const result = await service.getMyProfile(context);
    expect(result).toMatchObject({
      id: ID,
      isAdmin: true,
      location: { latitude: 10.7769, longitude: 106.7009 },
    });
    expect(repository.findOne).toHaveBeenCalledWith({ where: { id: ID } });
    expect(result).not.toHaveProperty("password");
    expect(result).not.toHaveProperty("avatarStorageKey");
  });
  it("returns null when location is unset and false for a regular user", async () => {
    user.location = null;
    user.isAdmin = false;
    expect(await service.getMyProfile(context)).toMatchObject({
      location: null,
      isAdmin: false,
    });
  });
  it("preserves zero coordinates", async () => {
    user.location = { type: "Point", coordinates: [0, 0] };
    expect((await service.getMyProfile(context)).location).toEqual({
      latitude: 0,
      longitude: 0,
    });
  });
  it("does not expose personal location through the public user profile", async () => {
    const result = await service.getUserProfile(ID, context);
    expect(result).not.toHaveProperty("location");
    expect(result).not.toHaveProperty("isAdmin");
  });
  it.each(["isAdmin", "location"])(
    "does not permit modifying %s through PATCH me",
    async (field) => {
      const patch = Object.assign(new UpdateUserDto(), {
        [field]: field === "isAdmin" ? true : { latitude: 1, longitude: 2 },
      });
      await expect(service.updateMyProfile(patch, context)).rejects.toThrow();
      expect(repository.update).not.toHaveBeenCalled();
    },
  );
});
