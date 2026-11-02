/**
 * MODULE: AUTHORIZATION (CASL & GUARDS)
 *
 * WORD TEST CASES:
 * - TC-AUT-01: assertRoute với cặp action/subject hợp lệ không ném lỗi; API giữ nguyên typing CASL thật
 */

import { subject } from "@casl/ability";
import { CheckPolicies } from "../../src/modules/authorization/decorators/check-policies.decorator";
import { AuthorizationService } from "../../src/modules/authorization/authorization.service";
import { CaslAbilityFactory } from "../../src/modules/authorization/casl-ability.factory";
import type {
  AppAbility,
  AuthorizationContext,
} from "../../src/modules/authorization/authorization.types";
// Compiled by tsc and ts-jest; never execute deliberately invalid calls.
function typeContract(
  ability: AppAbility,
  service: AuthorizationService,
  context: AuthorizationContext,
) {
  // @ts-expect-error lock belongs to User, not Post
  ability.can("lock", "Post");
  // @ts-expect-error tagged instances retain the subject/action relationship
  ability.can("sendMessage", subject("User", { id: "user" }));
  // @ts-expect-error wrong action/subject pair in service API
  service.assertRoute(context, "resolve", "Conversation");
  // @ts-expect-error wrong action/subject pair in route metadata
  CheckPolicies({ action: "markRead", subject: "Post" });
}
void typeContract;
// [WORD-TC: TC-AUT-01]
// Chức năng: assertRoute với cặp action/subject hợp lệ không ném lỗi; API giữ nguyên typing CASL thật
it("[TC-AUT-01] assertRoute với cặp action/subject hợp lệ không ném lỗi; API giữ nguyên typing CASL thật", () => {
  const service = new AuthorizationService(new CaslAbilityFactory());
  expect(() =>
    service.assertRoute(service.createGuestContext(), "read", "Post"),
  ).not.toThrow();
});
