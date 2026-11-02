/**
 * MODULE: USERS & HỒ SƠ CÁ NHÂN
 *
 * WORD TEST CASES:
 * - TC-USR-01: Trả về cờ isAdmin từ DB và tọa độ dạng tên (longitude/latitude) từ GeoJSON
 * - TC-USR-02: Location chưa đặt → null; user thường → isAdmin = false
 * - TC-USR-03: Giữ nguyên tọa độ 0 (không bị chuyển thành null)
 * - TC-USR-04: Không lộ vị trí cá nhân qua profile công khai
 * - TC-USR-05: Không cho phép sửa isAdmin qua PATCH /me
 * - TC-USR-06: Không cho phép sửa location qua PATCH /me
 */

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

  // [WORD-TC: TC-USR-01]
  // Chức năng: Trả về cờ isAdmin từ DB và tọa độ dạng tên (longitude/latitude) từ GeoJSON
  it("[TC-USR-01] Trả về cờ isAdmin từ DB và tọa độ dạng tên (longitude/latitude) từ GeoJSON", async () => {
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
  // [WORD-TC: TC-USR-02]
  // Chức năng: Location chưa đặt → null; user thường → isAdmin = false
  it("[TC-USR-02] Location chưa đặt → null; user thường → isAdmin = false", async () => {
    user.location = null;
    user.isAdmin = false;
    expect(await service.getMyProfile(context)).toMatchObject({
      location: null,
      isAdmin: false,
    });
  });
  // [WORD-TC: TC-USR-03]
  // Chức năng: Giữ nguyên tọa độ 0 (không bị chuyển thành null)
  it("[TC-USR-03] Giữ nguyên tọa độ 0 (không bị chuyển thành null)", async () => {
    user.location = { type: "Point", coordinates: [0, 0] };
    expect((await service.getMyProfile(context)).location).toEqual({
      latitude: 0,
      longitude: 0,
    });
  });
  // [WORD-TC: TC-USR-04]
  // Chức năng: Không lộ vị trí cá nhân qua profile công khai
  it("[TC-USR-04] Không lộ vị trí cá nhân qua profile công khai", async () => {
    const result = await service.getUserProfile(ID, context);
    expect(result).not.toHaveProperty("location");
    expect(result).not.toHaveProperty("isAdmin");
  });
  // [WORD-TC: TC-USR-05]
  // Chức năng: Không cho phép sửa isAdmin qua PATCH /me
  // [WORD-TC: TC-USR-06]
  // Chức năng: Không cho phép sửa location qua PATCH /me
  it.each(["isAdmin", "location"])(
    "[TC-USR] Không cho phép sửa trường %s thông qua PATCH /me",
    async (field) => {
      const patch = Object.assign(new UpdateUserDto(), {
        [field]: field === "isAdmin" ? true : { latitude: 1, longitude: 2 },
      });
      await expect(service.updateMyProfile(patch, context)).rejects.toThrow();
      expect(repository.update).not.toHaveBeenCalled();
    },
  );
});
