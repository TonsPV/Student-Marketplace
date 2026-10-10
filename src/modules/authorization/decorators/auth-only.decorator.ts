import { declareRouteAccess } from "../route-access.resolver";
export function AuthOnly(): MethodDecorator & ClassDecorator {
  return declareRouteAccess({ mode: "authOnly" });
}
