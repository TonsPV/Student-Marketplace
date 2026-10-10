import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { UserEntity } from "../../modules/user/user.entity";
import { RefreshTokenEntity } from "../../modules/refresh-token/refresh-token.entity";
import { AuthorizationModule } from "../../modules/authorization/authorization.module";
import { SessionRegistryModule } from "../session-registry/session-registry.module";
import { AccountLifecycleService } from "./account-lifecycle.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([UserEntity, RefreshTokenEntity]),
    AuthorizationModule,
    SessionRegistryModule,
  ],
  providers: [AccountLifecycleService],
  exports: [AccountLifecycleService],
})
export class AccountLifecycleModule {}
