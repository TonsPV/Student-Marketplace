import { InternalServerErrorException } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import {
  ACTIONS_BY_SUBJECT,
  type PolicyRequirement,
} from "./authorization.types";
export const AUTHORIZATION_ROUTE_KEY = "authorization:route";
const DECLARATIONS_KEY = "authorization:declarations";
export type RouteAccessDescriptor =
  | { mode: "public" }
  | { mode: "authOnly" }
  | { mode: "policy"; requirements: PolicyRequirement[] };
export function declareRouteAccess(
  descriptor: RouteAccessDescriptor,
): MethodDecorator & ClassDecorator {
  return (
    target: object,
    _property?: string | symbol,
    method?: PropertyDescriptor,
  ) => {
    const actual = method?.value ?? target;
    const declarations: RouteAccessDescriptor[] =
      Reflect.getOwnMetadata(DECLARATIONS_KEY, actual) ?? [];
    Reflect.defineMetadata(
      DECLARATIONS_KEY,
      [...declarations, descriptor],
      actual,
    );
    Reflect.defineMetadata(AUTHORIZATION_ROUTE_KEY, descriptor, actual);
  };
}
function readDescriptor(target: object): RouteAccessDescriptor | undefined {
  const declarations = Reflect.getOwnMetadata(DECLARATIONS_KEY, target) as
    RouteAccessDescriptor[] | undefined;
  if (declarations && declarations.length !== 1)
    throw new InternalServerErrorException("Conflicting route metadata");
  const descriptor = (declarations?.[0] ??
    Reflect.getOwnMetadata(AUTHORIZATION_ROUTE_KEY, target)) as
    RouteAccessDescriptor | undefined;
  if (!descriptor) return undefined;
  if (descriptor.mode === "policy") {
    if (
      !Array.isArray(descriptor.requirements) ||
      !descriptor.requirements.length
    )
      throw new InternalServerErrorException("Empty route policy");
    for (const requirement of descriptor.requirements) {
      const actions = ACTIONS_BY_SUBJECT[requirement.subject] as
        readonly string[] | undefined;
      if (!actions?.includes(requirement.action))
        throw new InternalServerErrorException("Invalid route action/subject");
    }
  } else if (descriptor.mode !== "public" && descriptor.mode !== "authOnly")
    throw new InternalServerErrorException("Invalid route access mode");
  return descriptor;
}
export function resolveRouteAccess(
  _reflector: Reflector,
  handler: Function,
  controllerClass: Function,
): RouteAccessDescriptor | null {
  const method = readDescriptor(handler);
  const controller = readDescriptor(controllerClass);
  return method ?? controller ?? null;
}
