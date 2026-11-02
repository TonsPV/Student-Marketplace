/**
 * MODULE: AUTHORIZATION (CASL & GUARDS)
 *
 * WORD TEST CASES:
 * - TC-GRD-01: Actor đã xác thực được truyền vào policy; thiếu actor → Unauthorized (401)
 * - TC-GRD-02: Metadata cấp method ghi đè metadata cấp class
 * - TC-GRD-03: Nhiều yêu cầu policy kết hợp theo logic AND
 * - TC-GRD-04: Route AuthOnly yêu cầu actor, thiếu actor bị từ chối
 * - TC-GRD-05: Khai báo Public + Policy mâu thuẫn → từ chối khi khởi tạo (thứ tự false)
 * - TC-GRD-06: Khai báo Public + Policy mâu thuẫn → từ chối khi khởi tạo (thứ tự true)
 * - TC-GRD-07: Khai báo AuthOnly + Policy mâu thuẫn → từ chối khi khởi tạo (thứ tự false)
 * - TC-GRD-08: Khai báo AuthOnly + Policy mâu thuẫn → từ chối khi khởi tạo (thứ tự true)
 * - TC-GRD-09: Route không khai báo quyền truy cập → mặc định từ chối (deny)
 * - TC-GRD-10: Metadata action/subject không hợp lệ khi runtime → guard báo lỗi
 */

import { Reflector } from "@nestjs/core";
import { UnauthorizedException, ForbiddenException } from "@nestjs/common";
import { PoliciesGuard } from "../../src/modules/authorization/guards/policies.guard";
import { AuthorizationService } from "../../src/modules/authorization/authorization.service";
import { CaslAbilityFactory } from "../../src/modules/authorization/casl-ability.factory";
import { CheckPolicies } from "../../src/modules/authorization/decorators/check-policies.decorator";
import { AuthOnly } from "../../src/modules/authorization/decorators/auth-only.decorator";
import { Public } from "../../src/common/decorators/customize.decorator";

function makeGuard(): PoliciesGuard {
  const reflector = new Reflector();
  const factory = new CaslAbilityFactory();
  const authorization = new AuthorizationService(factory);
  return new PoliciesGuard(reflector, authorization);
}

function httpContext(
  handler: Function,
  controller: Function,
  user?: { id: string; email: string; fullName: string; isAdmin: boolean },
): Parameters<PoliciesGuard["canActivate"]>[0] {
  const request: Record<string, unknown> = {};
  if (user) request.user = user;
  return {
    getType: () => "http",
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as Parameters<PoliciesGuard["canActivate"]>[0];
}

describe("PoliciesGuard (spec G01-G04)", () => {
  // [WORD-TC: TC-GRD-01]
  // Chức năng: Actor đã xác thực được truyền vào policy; thiếu actor → Unauthorized (401)
  test("[TC-GRD-01] Actor đã xác thực được truyền vào policy; thiếu actor → Unauthorized (401)", async () => {
    class C {
      @CheckPolicies({ action: "read", subject: "Conversation" })
      handler() {}
    }
    const guard = makeGuard();
    const actor = {
      id: "22222222-2222-2222-8222-222222222222",
      email: "u@example.com",
      fullName: "U",
      isAdmin: false,
    };
    const ctx = httpContext(C.prototype.handler, C, actor);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    const noUser = httpContext(C.prototype.handler, C, undefined);
    await expect(guard.canActivate(noUser)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  // [WORD-TC: TC-GRD-02]
  // Chức năng: Metadata cấp method ghi đè metadata cấp class
  test("[TC-GRD-02] Metadata cấp method ghi đè metadata cấp class", async () => {
    @CheckPolicies({ action: "delete", subject: "Category" })
    class PrivateController {
      @Public()
      handler() {}
    }
    const guard = makeGuard();
    // Public method: no actor needed.
    const ctx = httpContext(
      PrivateController.prototype.handler,
      PrivateController,
      undefined,
    );
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  // [WORD-TC: TC-GRD-03]
  // Chức năng: Nhiều yêu cầu policy kết hợp theo logic AND
  test("[TC-GRD-03] Nhiều yêu cầu policy kết hợp theo logic AND", async () => {
    class C {
      @CheckPolicies(
        { action: "read", subject: "Conversation" },
        { action: "delete", subject: "Category" },
      )
      handler() {}
    }
    const guard = makeGuard();
    const plainUser = {
      id: "22222222-2222-2222-8222-222222222222",
      email: "u@example.com",
      fullName: "U",
      isAdmin: false,
    };
    const ctx = httpContext(C.prototype.handler, C, plainUser);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    const admin = { ...plainUser, isAdmin: true };
    const adminCtx = httpContext(C.prototype.handler, C, admin);
    // Admin still needs conversation participation for the first requirement
    // (route gate on type passes, but AND requires both capabilities on type).
    // Category.delete passes for admin; Conversation.read on type passes for
    // any authenticated user, so guard allows (instance check is in service).
    await expect(guard.canActivate(adminCtx)).resolves.toBe(true);
  });

  // [WORD-TC: TC-GRD-04]
  // Chức năng: Route AuthOnly yêu cầu actor, thiếu actor bị từ chối
  test("[TC-GRD-04] Route AuthOnly yêu cầu actor, thiếu actor bị từ chối", async () => {
    class C {
      @AuthOnly()
      handler() {}
    }
    const guard = makeGuard();
    const anon = httpContext(C.prototype.handler, C, undefined);
    await expect(guard.canActivate(anon)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});

// Conflicts must survive decorator application order instead of last-write winning.
describe("route descriptor strictness", () => {
  // [WORD-TC: TC-GRD-05]
  // Chức năng: Khai báo Public + Policy mâu thuẫn → từ chối khi khởi tạo (thứ tự false)
  // [WORD-TC: TC-GRD-06]
  // Chức năng: Khai báo Public + Policy mâu thuẫn → từ chối khi khởi tạo (thứ tự true)
  test.each([false, true])(
    "[TC-GRD] Khai báo Public và Policy mâu thuẫn sẽ bị từ chối (%s)",
    async (reverse) => {
      class C {
        handler() {}
      }
      const descriptor = Object.getOwnPropertyDescriptor(
        C.prototype,
        "handler",
      )!;
      const decorators = [
        Public(),
        CheckPolicies({ action: "read", subject: "Post" }),
      ];
      for (const decorator of reverse ? decorators.reverse() : decorators)
        decorator(C.prototype, "handler", descriptor);
      await expect(
        makeGuard().canActivate(httpContext(C.prototype.handler, C)),
      ).rejects.toThrow("Conflicting route metadata");
    },
  );
  // [WORD-TC: TC-GRD-07]
  // Chức năng: Khai báo AuthOnly + Policy mâu thuẫn → từ chối khi khởi tạo (thứ tự false)
  // [WORD-TC: TC-GRD-08]
  // Chức năng: Khai báo AuthOnly + Policy mâu thuẫn → từ chối khi khởi tạo (thứ tự true)
  test.each([false, true])(
    "[TC-GRD] Khai báo AuthOnly và Policy mâu thuẫn sẽ bị từ chối (%s)",
    async (reverse) => {
      class C {
        handler() {}
      }
      const descriptor = Object.getOwnPropertyDescriptor(
        C.prototype,
        "handler",
      )!;
      const decorators = [
        AuthOnly(),
        CheckPolicies({ action: "read", subject: "Post" }),
      ];
      for (const decorator of reverse ? decorators.reverse() : decorators)
        decorator(C.prototype, "handler", descriptor);
      await expect(
        makeGuard().canActivate(httpContext(C.prototype.handler, C)),
      ).rejects.toThrow("Conflicting route metadata");
    },
  );
  // [WORD-TC: TC-GRD-09]
  // Chức năng: Route không khai báo quyền truy cập → mặc định từ chối (deny)
  test("[TC-GRD-09] Route không khai báo quyền truy cập → mặc định từ chối (deny)", async () => {
    class C {
      handler() {}
    }
    await expect(
      makeGuard().canActivate(httpContext(C.prototype.handler, C)),
    ).rejects.toThrow("Missing route authorization metadata");
  });
  // [WORD-TC: TC-GRD-10]
  // Chức năng: Metadata action/subject không hợp lệ khi runtime → guard báo lỗi
  test("[TC-GRD-10] Metadata action/subject không hợp lệ khi runtime → guard báo lỗi", async () => {
    class C {
      handler() {}
    }
    Reflect.defineMetadata(
      "authorization:route",
      { mode: "policy", requirements: [{ action: "lock", subject: "Post" }] },
      C.prototype.handler,
    );
    await expect(
      makeGuard().canActivate(httpContext(C.prototype.handler, C)),
    ).rejects.toThrow("Invalid route action/subject");
  });
});
