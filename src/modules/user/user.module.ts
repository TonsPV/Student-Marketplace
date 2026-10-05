import { Module } from "@nestjs/common";
import { UserService } from "./user.service";
import { UserController } from "./user.controller";
import { TypeOrmModule } from "@nestjs/typeorm";
import { UserEntity } from "./user.entity";
import { AdminSeeder } from "../../database/seeds/seed-admin";
import { AdminGuard } from "../../common/guards/admin.guard";
import { RefreshTokenModule } from "../refresh-token/refresh-token.module";

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity]), RefreshTokenModule],
  controllers: [UserController],
  providers: [UserService, AdminSeeder, AdminGuard],
  exports: [UserService],
})
export class UserModule {}
