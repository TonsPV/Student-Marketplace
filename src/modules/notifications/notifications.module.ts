import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ConversationsModule } from "../conversations/conversations.module";
import { NotificationEntity } from "./notification.entity";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";
import { AuthorizationModule } from "../authorization/authorization.module";

@Module({
  imports: [
    AuthorizationModule,
    TypeOrmModule.forFeature([NotificationEntity]),
    ConversationsModule,
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
