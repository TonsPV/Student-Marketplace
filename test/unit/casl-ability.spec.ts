import { subject } from "@casl/ability";
import { CaslAbilityFactory } from "../../src/modules/authorization/casl-ability.factory";
import { AuthorizationService } from "../../src/modules/authorization/authorization.service";
import type { AuthenticatedPrincipal } from "../../src/modules/authorization/authorization.types";
import {
  toConversationProjection,
  toPostProjection,
  toUserProjection,
} from "../../src/modules/authorization/subject-projections";

function principal(
  overrides: Partial<AuthenticatedPrincipal> & { id: string },
): AuthenticatedPrincipal {
  return {
    email: overrides.id + "@example.com",
    fullName: "Test User",
    isAdmin: false,
    ...overrides,
  };
}

const POST_ID = "11111111-1111-1111-8111-111111111111";
const SELLER_ID = "22222222-2222-2222-8222-222222222222";
const OUTSIDER_ID = "33333333-3333-3333-8333-333333333333";
const ADMIN_ID = "44444444-4444-4444-8444-444444444444";
const BUYER_ID = "55555555-5555-5555-8555-555555555555";
const CONV_ID = "66666666-6666-6666-8666-666666666666";

describe("CASL ability (spec U01-U10)", () => {
  const factory = new CaslAbilityFactory();
  const authorization = new AuthorizationService(factory);

  test("U01 guest allows only public reads", () => {
    const guest = factory.createForActor(null);
    expect(
      guest.can("read", subject("Post", { status: "active", deletedAt: null })),
    ).toBe(true);
    expect(
      guest.can("read", subject("Post", { status: "hidden", deletedAt: null })),
    ).toBe(false);
    expect(guest.can("read", "Category")).toBe(true);
    expect(guest.can("read", "Review")).toBe(true);
    expect(guest.can("create", "Post")).toBe(false);
    expect(guest.can("update", "Post")).toBe(false);
    expect(guest.can("create", "Conversation")).toBe(false);
    expect(guest.can("read", "Notification")).toBe(false);
  });

  test("U02 owner vs outsider vs admin-outsider on Post", () => {
    const seller = factory.createForActor(principal({ id: SELLER_ID }));
    const outsider = factory.createForActor(principal({ id: OUTSIDER_ID }));
    const admin = factory.createForActor(
      principal({ id: ADMIN_ID, isAdmin: true }),
    );
    const owned = subject("Post", {
      id: POST_ID,
      sellerId: SELLER_ID,
      status: "active",
      deletedAt: null,
    });
    expect(seller.can("update", owned, "title")).toBe(true);
    expect(seller.can("delete", owned)).toBe(true);
    expect(seller.can("manageImages", owned)).toBe(true);
    expect(outsider.can("update", owned, "title")).toBe(false);
    expect(outsider.can("delete", owned)).toBe(false);
    expect(admin.can("update", owned, "title")).toBe(false);
    // Admin keeps hide capability for moderation flow.
    expect(admin.can("hide", subject("Post", { id: POST_ID }))).toBe(true);
  });

  test("U03 participants allow, outsiders deny on Conversation", () => {
    const buyerAbility = factory.createForActor(principal({ id: BUYER_ID }));
    const sellerAbility = factory.createForActor(principal({ id: SELLER_ID }));
    const outsiderAbility = factory.createForActor(
      principal({ id: OUTSIDER_ID }),
    );
    const adminAbility = factory.createForActor(
      principal({ id: ADMIN_ID, isAdmin: true }),
    );
    const conv = {
      id: CONV_ID,
      buyerId: BUYER_ID,
      sellerId: SELLER_ID,
      postId: POST_ID,
    };
    for (const action of [
      "read",
      "readMessages",
      "sendMessage",
      "markRead",
      "join",
      "type",
    ] as const) {
      expect(buyerAbility.can(action, subject("Conversation", conv))).toBe(
        true,
      );
      expect(sellerAbility.can(action, subject("Conversation", conv))).toBe(
        true,
      );
      expect(outsiderAbility.can(action, subject("Conversation", conv))).toBe(
        false,
      );
      expect(adminAbility.can(action, subject("Conversation", conv))).toBe(
        false,
      );
    }
  });

  test("U04 admin self lock denied, lock other allowed", () => {
    const adminAbility = factory.createForActor(
      principal({ id: ADMIN_ID, isAdmin: true }),
    );
    expect(adminAbility.can("lock", subject("User", { id: ADMIN_ID }))).toBe(
      false,
    );
    expect(adminAbility.can("unlock", subject("User", { id: ADMIN_ID }))).toBe(
      false,
    );
    expect(adminAbility.can("lock", subject("User", { id: OUTSIDER_ID }))).toBe(
      true,
    );
    expect(
      adminAbility.can(
        "update",
        subject("User", { id: OUTSIDER_ID }),
        "fullName",
      ),
    ).toBe(false);
    const userAbility = factory.createForActor(principal({ id: OUTSIDER_ID }));
    expect(
      userAbility.can(
        "update",
        subject("User", { id: OUTSIDER_ID }),
        "fullName",
      ),
    ).toBe(true);
    expect(userAbility.can("lock", subject("User", { id: OUTSIDER_ID }))).toBe(
      false,
    );
  });

  test("U05 subject-type gate differs from instance check", () => {
    const outsiderCtx = authorization.createAuthenticatedContext(
      principal({ id: OUTSIDER_ID }),
    );
    // Route gate on type may allow (update capability exists for some post),
    // but instance of another seller must deny.
    expect(() =>
      authorization.assertResource(outsiderCtx, "update", "Post", {
        id: POST_ID,
        sellerId: SELLER_ID,
        status: "active",
        deletedAt: null,
      }),
    ).toThrow();
  });

  test("U06 field allowlist blocks privileged fields", () => {
    const sellerCtx = authorization.createAuthenticatedContext(
      principal({ id: SELLER_ID }),
    );
    const projection = {
      id: POST_ID,
      sellerId: SELLER_ID,
      status: "active",
      deletedAt: null,
    };
    expect(() =>
      authorization.assertUpdateFields(
        sellerCtx,
        "update",
        "Post",
        projection,
        {
          title: "ok",
        },
      ),
    ).not.toThrow();
    expect(() =>
      authorization.assertUpdateFields(
        sellerCtx,
        "update",
        "Post",
        projection,
        {
          sellerId: OUTSIDER_ID,
        },
      ),
    ).toThrow();
    expect(() =>
      authorization.assertUpdateFields(
        sellerCtx,
        "update",
        "Post",
        projection,
        {
          status: "sold",
        },
      ),
    ).toThrow();
  });

  test("U07 projection mapping rejects missing deletedAt", () => {
    expect(() =>
      toPostProjection({ id: POST_ID, sellerId: SELLER_ID, status: "active" }),
    ).toThrow();
    expect(
      toConversationProjection({
        id: CONV_ID,
        buyerId: BUYER_ID,
        sellerId: SELLER_ID,
        postId: POST_ID,
      }),
    ).toMatchObject({ id: CONV_ID });
    expect(() =>
      toUserProjection({ id: SELLER_ID, isLocked: false }),
    ).toThrow();
  });

  test("U08 null kept, undefined dropped in effective patch", () => {
    const patch = authorization.effectivePatch({
      rating: 5,
      comment: null,
      extra: undefined,
    });
    expect(patch).toEqual({ rating: 5, comment: null });
  });

  test("U09 prototype/dotted keys rejected", () => {
    const protoAttack = JSON.parse('{"__proto__":"x"}') as Record<
      string,
      unknown
    >;
    expect(() => authorization.effectivePatch(protoAttack)).toThrow();
    expect(() =>
      authorization.effectivePatch({ "location.type": "Point" }),
    ).toThrow();
  });

  test("U10 unknown action default deny", () => {
    const seller = factory.createForActor(principal({ id: SELLER_ID }));
    expect(
      seller.can(
        "nonexistent-action" as never,
        subject("Post", { id: POST_ID }),
      ),
    ).toBe(false);
  });
});
