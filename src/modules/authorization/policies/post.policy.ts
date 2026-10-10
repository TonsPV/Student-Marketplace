import type { AbilityBuilder } from "@casl/ability";
import { PostStatus } from "../../posts/post.entity";
import type {
  AppAbility,
  AuthenticatedPrincipal,
} from "../authorization.types";

export const POST_UPDATE_FIELDS = [
  "categoryId",
  "title",
  "description",
  "price",
  "condition",
  "location",
  "location.type",
  "location.coordinates",
] as const;

export function definePostRules(
  can: AbilityBuilder<AppAbility>["can"],
  actor: AuthenticatedPrincipal | null,
): void {
  if (!actor) {
    can("read", "Post", { status: PostStatus.ACTIVE, deletedAt: null });
    return;
  }
  can("read", "Post", { status: PostStatus.ACTIVE, deletedAt: null });
  can("read", "Post", { sellerId: actor.id, deletedAt: null });
  can("create", "Post", { sellerId: actor.id });
  can("update", "Post", [...POST_UPDATE_FIELDS], { sellerId: actor.id });
  can("markSold", "Post", { sellerId: actor.id });
  can("delete", "Post", { sellerId: actor.id });
  can("restore", "Post", { sellerId: actor.id });
  can("manageImages", "Post", { sellerId: actor.id });
}
