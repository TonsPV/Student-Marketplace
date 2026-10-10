import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { UserEntity } from "../../modules/user/user.entity";
import { AuthPrincipalService } from "./auth-principal.service";

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity])],
  providers: [AuthPrincipalService],
  exports: [AuthPrincipalService],
})
export class AuthPrincipalModule {}
