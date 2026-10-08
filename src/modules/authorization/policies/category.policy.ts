import type { AbilityBuilder } from "@casl/ability";
import type {
  AppAbility,
  AuthenticatedPrincipal,
} from "../authorization.types";

export const CATEGORY_UPDATE_FIELDS = ["name", "parentId"] as const;

export function defineCategoryRules(
  can: AbilityBuilder<AppAbility>["can"],
  actor: AuthenticatedPrincipal | null,
): void {
  can("read", "Category");
  if (actor?.isAdmin) {
    can("create", "Category");
    can("update", "Category", [...CATEGORY_UPDATE_FIELDS]);
    can("delete", "Category");
  }
}
