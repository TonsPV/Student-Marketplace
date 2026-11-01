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
  it("admin may warn/restrict/lift other users but never themselves", () => {
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

  it("D1: admin may read every moderation record, including their own", () => {
    const admin = actor(ADMIN, true);
    for (const userId of [USER, ADMIN]) {
      expect(admin.can("read", subject("UserWarning", { userId }))).toBe(true);
      expect(
        admin.can("read", subject("PostingRestriction", { userId })),
      ).toBe(true);
    }
  });

  it("regular users and guests get no moderation capability", () => {
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

  it("does not widen existing Review, Post or User capabilities", () => {
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
