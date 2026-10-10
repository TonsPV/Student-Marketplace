import type { AbilityBuilder } from "@casl/ability";
import type {
  AppAbility,
  AuthenticatedPrincipal,
} from "../authorization.types";

export function defineReportRules(
  can: AbilityBuilder<AppAbility>["can"],
  actor: AuthenticatedPrincipal | null,
): void {
  if (!actor) return;
  can("create", "Report", { reporterId: actor.id });
  if (actor.isAdmin) {
    can("read", "Report");
    can("resolve", "Report");
    can("hide", "Post");
  }
}
