/**
 * MODULE: USERS & HỒ SƠ CÁ NHÂN
 *
 * WORD TEST CASES:
 * - TC-LOC-01: Chặn các nghiệp vụ khi chưa có location nhưng vẫn cho phép truy cập profile/location
 * - TC-LOC-02: Kiểm tra lại trạng thái DB với cùng claims sau khi lưu, gồm cả tọa độ 0
 * - TC-LOC-03: Trạng thái sẵn sàng location từ DB được giữ nguyên khi đi qua HTTP policy guard
 */

import "reflect-metadata";
import { ForbiddenException } from "@nestjs/common";
import { Repository } from "typeorm";
import { AuthPrincipalService } from "../../src/common/auth-principal/auth-principal.service";
import { UserEntity } from "../../src/modules/user/user.entity";
import { AuthorizationService } from "../../src/modules/authorization/authorization.service";
import { CaslAbilityFactory } from "../../src/modules/authorization/casl-ability.factory";
import { PoliciesGuard } from "../../src/modules/authorization/guards/policies.guard";
import { CheckPolicies } from "../../src/modules/authorization/decorators/check-policies.decorator";
import { Reflector } from "@nestjs/core";

describe("mandatory default location", () => {
  const authorization = new AuthorizationService(new CaslAbilityFactory());
  const actor = {
    id: "11111111-1111-4111-8111-111111111111",
    email: "test@example.test",
    fullName: "Test",
    isAdmin: false,
    hasLocation: false,
  };
  // [WORD-TC: TC-LOC-01]
  // Chức năng: Chặn các nghiệp vụ khi chưa có location nhưng vẫn cho phép truy cập profile/location
  it("[TC-LOC-01] Chặn các nghiệp vụ khi chưa có location nhưng vẫn cho phép truy cập profile/location", () => {
    const context = authorization.createAuthenticatedContext(actor);
    expect(() => authorization.assertRoute(context, "create", "Post")).toThrow(
      ForbiddenException,
    );
    try {
      authorization.assertRoute(context, "read", "Conversation");
    } catch (error) {
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        code: "LOCATION_REQUIRED",
      });
    }
    expect(() =>
      authorization.assertRoute(context, "updateLocation", "User"),
    ).not.toThrow();
    expect(() =>
      authorization.assertRoute(context, "read", "User"),
    ).not.toThrow();
    expect(() =>
      authorization.assertResource(context, "join", "Conversation", {}),
    ).toThrow(ForbiddenException);
    expect(() => authorization.assertCreate(context, "Post", {})).toThrow(
      ForbiddenException,
    );
    expect(() =>
      authorization.assertRoute(
        authorization.createGuestContext(),
        "read",
        "Post",
      ),
    ).not.toThrow();
    expect(() =>
      authorization.assertRoute(
        authorization.createAuthenticatedContext({ ...actor, isAdmin: true }),
        "create",
        "Post",
      ),
    ).not.toThrow();
  });
  // [WORD-TC: TC-LOC-02]
  // Chức năng: Kiểm tra lại trạng thái DB với cùng claims sau khi lưu, gồm cả tọa độ 0
  it("[TC-LOC-02] Kiểm tra lại trạng thái DB với cùng claims sau khi lưu, gồm cả tọa độ 0", async () => {
    const findOne = jest
      .fn()
      .mockResolvedValue({ ...actor, isLocked: false, location: null });
    const principals = new AuthPrincipalService({
      findOne,
    } as unknown as Repository<UserEntity>);
    const claims = {
      id: actor.id,
      exp: Date.now() / 1000 + 300,
      hasLocation: true,
    };
    const before = await principals.resolveFromVerifiedClaims(claims);
    expect(before.hasLocation).toBe(false);
    findOne.mockResolvedValue({
      ...actor,
      isLocked: false,
      location: { type: "Point", coordinates: [0, 0] },
    });
    const after = await principals.resolveFromVerifiedClaims(claims);
    expect(after.hasLocation).toBe(true);
    expect(() =>
      authorization.assertRoute(
        authorization.createAuthenticatedContext(after),
        "create",
        "Post",
      ),
    ).not.toThrow();
  });
  // [WORD-TC: TC-LOC-03]
  // Chức năng: Trạng thái sẵn sàng location từ DB được giữ nguyên khi đi qua HTTP policy guard
  it("[TC-LOC-03] Trạng thái sẵn sàng location từ DB được giữ nguyên khi đi qua HTTP policy guard", async () => {
    class Controller {
      @CheckPolicies({ action: "create", subject: "Post" }) create() {}
    }
    const guard = new PoliciesGuard(new Reflector(), authorization);
    const context = {
      getType: () => "http",
      getClass: () => Controller,
      getHandler: () => Controller.prototype.create,
      switchToHttp: () => ({ getRequest: () => ({ user: actor }) }),
    } as unknown as Parameters<PoliciesGuard["canActivate"]>[0];
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      response: { code: "LOCATION_REQUIRED" },
    });
  });
});
