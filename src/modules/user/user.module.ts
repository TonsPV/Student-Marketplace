import { StorageModule } from "../storage/storage.module";
import { Module } from "@nestjs/common";
import { UserService } from "./user.service";
import { UserController } from "./user.controller";
import { PublicUserService } from "./public-user.service";
import { TypeOrmModule } from "@nestjs/typeorm";
import { UserEntity } from "./user.entity";
import { AdminSeeder } from "../../database/seeds/seed-admin";
import { AuthorizationModule } from "../authorization/authorization.module";
import { AccountLifecycleModule } from "../../common/account-lifecycle/account-lifecycle.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([UserEntity]),
    AuthorizationModule,
    StorageModule,
    AccountLifecycleModule,
  ],
  controllers: [UserController],
  providers: [UserService, PublicUserService, AdminSeeder],
  exports: [UserService],
})
export class UserModule {}
