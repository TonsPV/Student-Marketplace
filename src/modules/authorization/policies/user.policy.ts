import type { AbilityBuilder } from "@casl/ability";
import type {
  AppAbility,
  AuthenticatedPrincipal,
} from "../authorization.types";

export const USER_UPDATE_FIELDS = ["fullName", "phone", "avatarUrl"] as const;

export function defineUserRules(
  can: AbilityBuilder<AppAbility>["can"],
  actor: AuthenticatedPrincipal | null,
): void {
  if (!actor) return;
  can("read", "User");
  can("update", "User", [...USER_UPDATE_FIELDS], { id: actor.id });
  can("updateLocation", "User", { id: actor.id });
  can("delete", "User", { id: actor.id });
  can("changePassword", "User", { id: actor.id });
  if (actor.isAdmin) {
    can("lock", "User", { id: { $ne: actor.id } });
    can("unlock", "User", { id: { $ne: actor.id } });
  }
}
