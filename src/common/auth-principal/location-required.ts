import { ForbiddenException } from "@nestjs/common";
import type { AuthenticatedPrincipal } from "../../modules/authorization/authorization.types";

export function assertLocationReady(principal: AuthenticatedPrincipal): void {
  if (!principal.isAdmin && principal.hasLocation === false) {
    throw new ForbiddenException({
      statusCode: 403,
      code: "LOCATION_REQUIRED",
      message: "Choose your default location to continue",
    });
  }
}
