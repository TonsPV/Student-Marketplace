import type { AbilityBuilder } from "@casl/ability";
import type {
  AppAbility,
  AuthenticatedPrincipal,
} from "../authorization.types";

export const REVIEW_UPDATE_FIELDS = ["rating", "comment"] as const;

export function defineReviewRules(
  can: AbilityBuilder<AppAbility>["can"],
  actor: AuthenticatedPrincipal | null,
): void {
  can("read", "Review");
  if (!actor) return;
  can("create", "Review", { reviewerId: actor.id });
  can("update", "Review", [...REVIEW_UPDATE_FIELDS], { reviewerId: actor.id });
  can("delete", "Review", { reviewerId: actor.id });
}
