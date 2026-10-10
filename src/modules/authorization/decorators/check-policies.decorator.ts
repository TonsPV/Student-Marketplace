import { declareRouteAccess } from "../route-access.resolver";
import type { PolicyRequirement } from "../authorization.types";
export type CheckPoliciesRequirement = PolicyRequirement;
export function CheckPolicies(
  ...requirements: PolicyRequirement[]
): MethodDecorator & ClassDecorator {
  return declareRouteAccess({ mode: "policy", requirements });
}
