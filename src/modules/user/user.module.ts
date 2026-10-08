import { Module } from "@nestjs/common";
import { UserService } from "./user.service";
import { UserController } from "./user.controller";
import { TypeOrmModule } from "@nestjs/typeorm";
import { UserEntity } from "./user.entity";
import { AdminSeeder } from "../../database/seeds/seed-admin";
import { AuthorizationModule } from "../authorization/authorization.module";
import { AccountLifecycleModule } from "../../common/account-lifecycle/account-lifecycle.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([UserEntity]),
    AuthorizationModule,
    AccountLifecycleModule,
  ],
  controllers: [UserController],
  providers: [UserService, AdminSeeder],
  exports: [UserService],
})
export class UserModule {}
