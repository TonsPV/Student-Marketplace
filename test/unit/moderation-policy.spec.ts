/**
 * MODULE: MODERATION & POSTING RESTRICTIONS
 *
 * WORD TEST CASES:
 * - TC-MPL-01: Admin được warn/restrict/lift người khác nhưng không tự thao tác với chính mình
 * - TC-MPL-02: Admin đọc được mọi bản ghi moderation, kể cả của chính mình
 * - TC-MPL-03: User thường và guest không có bất kỳ capability moderation nào
 * - TC-MPL-04: Không mở rộng quyền đã có trên Review, Post, User
 */

import { subject } from "@casl/ability";
import { CaslAbilityFactory } from "../../src/modules/authorization/casl-ability.factory";

const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const factory = new CaslAbilityFactory();
const actor = (id: string, isAdmin: boolean) =>
  factory.createForActor({
    id,
    email: `${id}@example.test`,
    fullName: "Test",
    isAdmin,
  });

describe("moderation CASL policy", () => {
  // [WORD-TC: TC-MPL-01]
  // Chức năng: Admin được warn/restrict/lift người khác nhưng không tự thao tác với chính mình
  it("[TC-MPL-01] Admin được warn/restrict/lift người khác nhưng không tự thao tác với chính mình", () => {
    const admin = actor(ADMIN, true);
    // CASL tags the object passed to subject(), so build a fresh one per call.
    const other = () => ({ userId: USER });
    const self = () => ({ userId: ADMIN });
    expect(admin.can("create", subject("UserWarning", other()))).toBe(true);
    expect(admin.can("read", subject("UserWarning", other()))).toBe(true);
    expect(admin.can("create", subject("PostingRestriction", other()))).toBe(
      true,
    );
    expect(admin.can("read", subject("PostingRestriction", other()))).toBe(
      true,
    );
    expect(admin.can("lift", subject("PostingRestriction", other()))).toBe(
      true,
    );
    expect(admin.can("create", subject("UserWarning", self()))).toBe(false);
    expect(admin.can("create", subject("PostingRestriction", self()))).toBe(
      false,
    );
    expect(admin.can("lift", subject("PostingRestriction", self()))).toBe(
      false,
    );
  });

  // [WORD-TC: TC-MPL-02]
  // Chức năng: Admin đọc được mọi bản ghi moderation, kể cả của chính mình
  it("[TC-MPL-02] Admin đọc được mọi bản ghi moderation, kể cả của chính mình", () => {
    const admin = actor(ADMIN, true);
    for (const userId of [USER, ADMIN]) {
      expect(admin.can("read", subject("UserWarning", { userId }))).toBe(true);
      expect(
        admin.can("read", subject("PostingRestriction", { userId })),
      ).toBe(true);
    }
  });

  // [WORD-TC: TC-MPL-03]
  // Chức năng: User thường và guest không có bất kỳ capability moderation nào
  it("[TC-MPL-03] User thường và guest không có bất kỳ capability moderation nào", () => {
    for (const ability of [actor(USER, false), factory.createForActor(null)]) {
      expect(ability.can("create", "UserWarning")).toBe(false);
      expect(ability.can("read", "UserWarning")).toBe(false);
      expect(ability.can("create", "PostingRestriction")).toBe(false);
      expect(ability.can("read", "PostingRestriction")).toBe(false);
      expect(ability.can("lift", "PostingRestriction")).toBe(false);
      expect(
        ability.can("create", subject("PostingRestriction", { userId: USER })),
      ).toBe(false);
    }
  });

  // [WORD-TC: TC-MPL-04]
  // Chức năng: Không mở rộng quyền đã có trên Review, Post, User
  it("[TC-MPL-04] Không mở rộng quyền đã có trên Review, Post, User", () => {
    const admin = actor(ADMIN, true);
    expect(admin.can("delete", subject("Review", { reviewerId: USER }))).toBe(
      false,
    );
    expect(
      admin.can("update", subject("Post", { sellerId: USER }), "title"),
    ).toBe(false);
    expect(actor(USER, false).can("lock", subject("User", { id: ADMIN }))).toBe(
      false,
    );
  });
});
