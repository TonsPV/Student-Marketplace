import { UserEntity } from "../user/user.entity";
import { PostRenewalEntity } from "./post-renewal.entity";
import { PostLifecycleService } from "./post-lifecycle.service";
import {
  PostActivationPolicyService,
  POSTING_RESTRICTION_POLICY,
} from "./post-activation-policy.service";
import { ModerationPostingPolicy } from "./moderation-posting-policy";
import { PostExpiryService } from "./post-expiry.service";
import { PostExpiryScheduler } from "./post-expiry.scheduler";
import { StorageModule } from "../storage/storage.module";
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CategoryEntity } from "../categories/category.entity";
import { PostEntity } from "./post.entity";
import { PostPromotionEntity } from "./post-promotion.entity";
import { PostsController } from "./posts.controller";
import { AdminPostPromotionsController } from "./admin-post-promotions.controller";
import { PostsService } from "./posts.service";
import { PostPromotionsService } from "./post-promotions.service";
import { AuthorizationModule } from "../authorization/authorization.module";
import { ConversationEntity } from "../conversations/entities/conversation.entity";
import { MessageEntity } from "../messages/entities/message.entity";
import { ReviewEntity } from "../reviews/review.entity";
import { NotificationEntity } from "../notifications/notification.entity";
import { NotificationsModule } from "../notifications/notifications.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { ModerationModule } from "../moderation/moderation.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PostEntity,
      PostPromotionEntity,
      CategoryEntity,
      ConversationEntity,
      MessageEntity,
      ReviewEntity,
      NotificationEntity,
      UserEntity,
      PostRenewalEntity,
    ]),
    AuthorizationModule,
    StorageModule,
    NotificationsModule,
    RealtimeModule,
    ModerationModule,
  ],
  controllers: [PostsController, AdminPostPromotionsController],
  providers: [
    PostsService,
    PostPromotionsService,
    PostLifecycleService,
    PostActivationPolicyService,
    ModerationPostingPolicy,
    {
      provide: POSTING_RESTRICTION_POLICY,
      useExisting: ModerationPostingPolicy,
    },
    PostExpiryService,
    PostExpiryScheduler,
  ],
  exports: [PostsService, PostLifecycleService],
})
export class PostsModule {}
