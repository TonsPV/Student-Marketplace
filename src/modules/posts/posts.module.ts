import { StorageModule } from "../storage/storage.module";
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CategoryEntity } from "../categories/category.entity";
import { PostEntity } from "./post.entity";
import { PostsController } from "./posts.controller";
import { PostsService } from "./posts.service";
import { AuthorizationModule } from "../authorization/authorization.module";
import { ConversationEntity } from "../conversations/entities/conversation.entity";
import { MessageEntity } from "../messages/entities/message.entity";
import { ReviewEntity } from "../reviews/review.entity";
import { NotificationEntity } from "../notifications/notification.entity";
import { NotificationsModule } from "../notifications/notifications.module";
import { RealtimeModule } from "../realtime/realtime.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PostEntity,
      CategoryEntity,
      ConversationEntity,
      MessageEntity,
      ReviewEntity,
      NotificationEntity,
    ]),
    AuthorizationModule,
    StorageModule,
    NotificationsModule,
    RealtimeModule,
  ],
  controllers: [PostsController],
  providers: [PostsService],
  exports: [PostsService],
})
export class PostsModule {}
