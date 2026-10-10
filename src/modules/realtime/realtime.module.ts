import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { RealtimeGateway } from "./realtime.gateway";
import { RealtimeService } from "./realtime.service";
import { AuthPrincipalModule } from "../../common/auth-principal/auth-principal.module";
import { SessionRegistryModule } from "../../common/session-registry/session-registry.module";

@Global()
@Module({
  imports: [
    AuthPrincipalModule,
    SessionRegistryModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (c: ConfigService) => ({
        secret: c.getOrThrow("JWT_ACCESS_SECRET"),
      }),
    }),
  ],
  providers: [RealtimeGateway, RealtimeService],
  exports: [RealtimeService],
})
export class RealtimeModule {}
