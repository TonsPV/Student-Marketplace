import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { AdminGuard } from "../../common/guards/admin.guard";
import { PostEntity } from "../posts/post.entity";
import { UserEntity } from "../user/user.entity";
import { ReportEntity } from "./report.entity";
import { ReportsController } from "./reports.controller";
import { ReportsService } from "./reports.service";

@Module({
  imports: [TypeOrmModule.forFeature([ReportEntity, PostEntity, UserEntity])],
  controllers: [ReportsController],
  providers: [ReportsService, AdminGuard],
})
export class ReportsModule {}
