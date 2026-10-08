import { DiscoveryModule, MetadataScanner } from "@nestjs/core";
import { Module } from "@nestjs/common";
import { CaslAbilityFactory } from "./casl-ability.factory";
import { AuthorizationService } from "./authorization.service";
import { PoliciesGuard } from "./guards/policies.guard";

@Module({
  imports: [DiscoveryModule],
  providers: [
    CaslAbilityFactory,
    AuthorizationService,
    PoliciesGuard,
    MetadataScanner,
  ],
  exports: [CaslAbilityFactory, AuthorizationService, PoliciesGuard],
})
export class AuthorizationModule {}
