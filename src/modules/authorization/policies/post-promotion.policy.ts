import type { AbilityBuilder } from "@casl/ability";
import type {
  AppAbility,
  AuthenticatedPrincipal,
} from "../authorization.types";

/**
 * Post promotions are admin-managed (Phase 4 Step 2). There is no payment
 * flow, so sellers cannot self-promote; only admins may create, read or
 * cancel promotion windows. Regular users get no capability here.
 */
export function definePostPromotionRules(
  can: AbilityBuilder<AppAbility>["can"],
  actor: AuthenticatedPrincipal | null,
): void {
  if (!actor?.isAdmin) return;
  can("create", "PostPromotion");
  can("read", "PostPromotion");
  can("cancel", "PostPromotion");
}
