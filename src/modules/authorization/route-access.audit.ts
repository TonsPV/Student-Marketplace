import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { ModulesContainer, Reflector } from "@nestjs/core";
import { MetadataScanner } from "@nestjs/core/metadata-scanner";
import { DiscoveryService } from "@nestjs/core/discovery";
import { PATH_METADATA, METHOD_METADATA } from "@nestjs/common/constants";
import { resolveRouteAccess } from "./route-access.resolver";

const VALID_SUBJECTS = new Set([
  "Post",
  "Category",
  "User",
  "Report",
  "Review",
  "Favorite",
  "Conversation",
  "Notification",
  "Upload",
]);

export function auditRouteAccess(
  discovery: DiscoveryService,
  scanner: MetadataScanner,
  reflector: Reflector,
  modules: ModulesContainer,
  logger = new Logger("RouteAccessAudit"),
): void {
  const controllers = discovery.getControllers();
  const errors: string[] = [];
  for (const wrapper of controllers.values()) {
    const instance = wrapper.instance;
    if (!instance) continue;
    const prototype = Object.getPrototypeOf(instance);
    const methodNames = scanner.getAllMethodNames(prototype);
    for (const name of methodNames) {
      const handler = prototype[name];
      if (typeof handler !== "function") continue;
      const path = Reflect.getMetadata(PATH_METADATA, handler);
      const httpMethod = Reflect.getMetadata(METHOD_METADATA, handler);
      if (path === undefined || httpMethod === undefined) continue;
      const descriptor = resolveRouteAccess(
        reflector,
        handler as Function,
        prototype.constructor as Function,
      );
      const label = `${prototype.constructor.name}.${String(name)}`;
      if (!descriptor) {
        errors.push(`${label}: missing Public/AuthOnly/Policy descriptor`);
        continue;
      }
      if (descriptor.mode === "policy") {
        if (!descriptor.requirements || descriptor.requirements.length === 0) {
          errors.push(`${label}: policy descriptor has empty requirements`);
        }
        for (const req of descriptor.requirements ?? []) {
          if (!VALID_SUBJECTS.has(req.subject)) {
            errors.push(`${label}: unknown subject ${req.subject}`);
          }
          if (!req.action) {
            errors.push(`${label}: empty action`);
          }
        }
      }
    }
  }
  void modules;
  if (errors.length > 0) {
    for (const e of errors) logger.error(e);
    throw new Error("Route authorization audit failed:\n" + errors.join("\n"));
  }
}

@Injectable()
export class RouteAccessAudit implements OnApplicationBootstrap {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
    private readonly modules: ModulesContainer,
  ) {}
  onApplicationBootstrap(): void {
    auditRouteAccess(
      this.discovery,
      this.scanner,
      this.reflector,
      this.modules,
    );
  }
}
