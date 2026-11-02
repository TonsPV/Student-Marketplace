import type { AbilityBuilder } from "@casl/ability";
import type {
  AppAbility,
  AuthenticatedPrincipal,
} from "../authorization.types";

/**
 * Warnings and posting restrictions are admin-only. Admins may READ every
 * moderation record, including their own history (decision D1). CREATE and
 * LIFT never target the acting admin. Regular users get no capability on
 * administrative records here; AuthOnly self endpoints return sanitized
 * status/history with ownership enforced inside ModerationService.
 */
export function defineModerationRules(
  can: AbilityBuilder<AppAbility>["can"],
  actor: AuthenticatedPrincipal | null,
): void {
  if (!actor?.isAdmin) return;
  const otherUser = { userId: { $ne: actor.id } };
  can("create", "UserWarning", otherUser);
  can("read", "UserWarning");
  can("create", "PostingRestriction", otherUser);
  can("read", "PostingRestriction");
  can("lift", "PostingRestriction", otherUser);
}
