import type { AbilityBuilder } from "@casl/ability";
import type {
  AppAbility,
  AuthenticatedPrincipal,
} from "../authorization.types";

const PARTICIPANT_ACTIONS = [
  "read",
  "readMessages",
  "sendMessage",
  "markRead",
  "join",
  "type",
] as const;

export function defineConversationRules(
  can: AbilityBuilder<AppAbility>["can"],
  actor: AuthenticatedPrincipal | null,
): void {
  if (!actor) return;
  can("create", "Conversation", { buyerId: actor.id });
  for (const action of PARTICIPANT_ACTIONS) {
    can(action, "Conversation", { buyerId: actor.id });
    can(action, "Conversation", { sellerId: actor.id });
  }
}
