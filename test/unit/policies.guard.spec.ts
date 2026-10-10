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
  test("G01 authenticated actor visible to policy; missing actor 401", async () => {
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

  test("G02 method descriptor overrides class descriptor", async () => {
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

  test("G04 AND over multiple requirements", async () => {
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

  test("AuthOnly requires actor", async () => {
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
  test.each([false, true])(
    "Public/Policy conflict rejects in either order (%s)",
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
  test.each([false, true])(
    "AuthOnly/Policy conflict rejects in either order (%s)",
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
  test("missing access declaration defaults to deny", async () => {
    class C {
      handler() {}
    }
    await expect(
      makeGuard().canActivate(httpContext(C.prototype.handler, C)),
    ).rejects.toThrow("Missing route authorization metadata");
  });
  test("invalid runtime action/subject metadata fails", async () => {
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
