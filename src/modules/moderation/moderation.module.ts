import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthorizationModule } from "../authorization/authorization.module";
import { UserWarningEntity } from "./user-warning.entity";
import { PostingRestrictionEntity } from "./posting-restriction.entity";
import { ModerationService } from "./moderation.service";
import { AdminModerationController } from "./admin-moderation.controller";
import { UserModerationController } from "./user-moderation.controller";

/** Phase 1 model/policy + Phase 2 admin API. */
@Module({
  imports: [
    TypeOrmModule.forFeature([UserWarningEntity, PostingRestrictionEntity]),
    AuthorizationModule,
  ],
  controllers: [AdminModerationController, UserModerationController],
  providers: [ModerationService],
  exports: [ModerationService],
})
export class ModerationModule {}
