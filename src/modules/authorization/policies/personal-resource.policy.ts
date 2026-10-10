import type { AbilityBuilder } from "@casl/ability";
import type {
  AppAbility,
  AuthenticatedPrincipal,
} from "../authorization.types";

export function definePersonalResourceRules(
  can: AbilityBuilder<AppAbility>["can"],
  actor: AuthenticatedPrincipal | null,
): void {
  if (!actor) return;
  can("create", "Favorite", { userId: actor.id });
  can("read", "Favorite", { userId: actor.id });
  can("delete", "Favorite", { userId: actor.id });
  can("read", "Notification", { userId: actor.id });
  can("markRead", "Notification", { userId: actor.id });
  can("create", "Upload", {
    ownerId: actor.id,
    purpose: { $in: ["message", "post"] },
  });
}
