import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { PostEntity } from "../posts/post.entity";
import { UserEntity } from "../user/user.entity";
import { RefreshTokenEntity } from "../refresh-token/refresh-token.entity";
import { ReportEntity } from "./report.entity";
import { ReportsController } from "./reports.controller";
import { ReportsService } from "./reports.service";
import { AuthorizationModule } from "../authorization/authorization.module";
import { AccountLifecycleModule } from "../../common/account-lifecycle/account-lifecycle.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ReportEntity,
      PostEntity,
      UserEntity,
      RefreshTokenEntity,
    ]),
    AuthorizationModule,
    AccountLifecycleModule,
  ],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
