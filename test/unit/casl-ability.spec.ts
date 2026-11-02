/**
 * MODULE: AUTHORIZATION (CASL & GUARDS)
 *
 * WORD TEST CASES:
 * - TC-CASL-01: Guest chỉ được phép đọc dữ liệu public (Post active/sold, Category, Review)
 * - TC-CASL-02: Owner được update/delete/manageImages tin của mình; outsider và admin không được; admin vẫn giữ quyền hide phục vụ moderation
 * - TC-CASL-03: Buyer/seller của hội thoại được phép thao tác; outsider và admin không được phép
 * - TC-CASL-04: Admin không thể tự khóa tài khoản mình nhưng khóa được user khác
 * - TC-CASL-05: Gate theo subject-type có thể cho phép nhưng kiểm tra theo instance vẫn từ chối tin của seller khác
 * - TC-CASL-06: Cho phép cập nhật title; từ chối field đặc quyền (sellerId, status)
 * - TC-CASL-07: toPostProjection/toUserProjection từ chối thiếu deletedAt; toConversationProjection ánh xạ đúng
 * - TC-CASL-08: effectivePatch giữ giá trị null, loại bỏ undefined
 * - TC-CASL-09: Từ chối key __proto__ và key chứa dấu chấm (prototype pollution)
 * - TC-CASL-10: Action không xác định bị từ chối mặc định (default deny)
 */

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

  // [WORD-TC: TC-CASL-01]
  // Chức năng: Guest chỉ được phép đọc dữ liệu public (Post active/sold, Category, Review)
  test("[TC-CASL-01] Guest chỉ được phép đọc dữ liệu public (Post active/sold, Category, Review)", () => {
    const guest = factory.createForActor(null);
    expect(
      guest.can("read", subject("Post", { status: "active", deletedAt: null })),
    ).toBe(true);
    expect(
      guest.can("read", subject("Post", { status: "hidden", deletedAt: null })),
    ).toBe(false);
    expect(guest.can("read", "Category")).toBe(true);
    expect(guest.can("read", subject("Post", { status: "sold", deletedAt: null }))).toBe(true);
    expect(guest.can("read", subject("Post", { status: "sold", deletedAt: new Date() }))).toBe(false);
    expect(guest.can("read", "Review")).toBe(true);
    expect(guest.can("create", "Post")).toBe(false);
    expect(guest.can("update", "Post")).toBe(false);
    expect(guest.can("create", "Conversation")).toBe(false);
    expect(guest.can("read", "Notification")).toBe(false);
  });

  // [WORD-TC: TC-CASL-02]
  // Chức năng: Owner được update/delete/manageImages tin của mình; outsider và admin không được; admin vẫn giữ quyền hide phục vụ moderation
  test("[TC-CASL-02] Owner được update/delete/manageImages tin của mình; outsider và admin không được; admin vẫn giữ quyền hide phục vụ moderation", () => {
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

  // [WORD-TC: TC-CASL-03]
  // Chức năng: Buyer/seller của hội thoại được phép thao tác; outsider và admin không được phép
  test("[TC-CASL-03] Buyer/seller của hội thoại được phép thao tác; outsider và admin không được phép", () => {
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

  // [WORD-TC: TC-CASL-04]
  // Chức năng: Admin không thể tự khóa tài khoản mình nhưng khóa được user khác
  test("[TC-CASL-04] Admin không thể tự khóa tài khoản mình nhưng khóa được user khác", () => {
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

  // [WORD-TC: TC-CASL-05]
  // Chức năng: Gate theo subject-type có thể cho phép nhưng kiểm tra theo instance vẫn từ chối tin của seller khác
  test("[TC-CASL-05] Gate theo subject-type có thể cho phép nhưng kiểm tra theo instance vẫn từ chối tin của seller khác", () => {
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

  // [WORD-TC: TC-CASL-06]
  // Chức năng: Cho phép cập nhật title; từ chối field đặc quyền (sellerId, status)
  test("[TC-CASL-06] Cho phép cập nhật title; từ chối field đặc quyền (sellerId, status)", () => {
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

  // [WORD-TC: TC-CASL-07]
  // Chức năng: toPostProjection/toUserProjection từ chối thiếu deletedAt; toConversationProjection ánh xạ đúng
  test("[TC-CASL-07] toPostProjection/toUserProjection từ chối thiếu deletedAt; toConversationProjection ánh xạ đúng", () => {
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

  // [WORD-TC: TC-CASL-08]
  // Chức năng: effectivePatch giữ giá trị null, loại bỏ undefined
  test("[TC-CASL-08] effectivePatch giữ giá trị null, loại bỏ undefined", () => {
    const patch = authorization.effectivePatch({
      rating: 5,
      comment: null,
      extra: undefined,
    });
    expect(patch).toEqual({ rating: 5, comment: null });
  });

  // [WORD-TC: TC-CASL-09]
  // Chức năng: Từ chối key __proto__ và key chứa dấu chấm (prototype pollution)
  test("[TC-CASL-09] Từ chối key __proto__ và key chứa dấu chấm (prototype pollution)", () => {
    const protoAttack = JSON.parse('{"__proto__":"x"}') as Record<
      string,
      unknown
    >;
    expect(() => authorization.effectivePatch(protoAttack)).toThrow();
    expect(() =>
      authorization.effectivePatch({ "location.type": "Point" }),
    ).toThrow();
  });

  // [WORD-TC: TC-CASL-10]
  // Chức năng: Action không xác định bị từ chối mặc định (default deny)
  test("[TC-CASL-10] Action không xác định bị từ chối mặc định (default deny)", () => {
    const seller = factory.createForActor(principal({ id: SELLER_ID }));
    expect(
      seller.can(
        "nonexistent-action" as never,
        subject("Post", { id: POST_ID }),
      ),
    ).toBe(false);
  });
});
