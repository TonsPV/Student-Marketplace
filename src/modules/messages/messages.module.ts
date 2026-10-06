import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ConversationsModule } from "../conversations/conversations.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { StorageModule } from "../storage/storage.module";
import { UserEntity } from "../user/user.entity";
import { ChatGateway } from "./chat.gateway";
import { ConversationMessagesController } from "./conversation-messages.controller";
import { MessageImageEntity } from "./entities/message-image.entity";
import { MessageEntity } from "./entities/message.entity";
import { MessagesController } from "./messages.controller";
import { MessagesService } from "./messages.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([MessageEntity, MessageImageEntity, UserEntity]),
    ConversationsModule,
    NotificationsModule,
    StorageModule,
  ],
  controllers: [MessagesController, ConversationMessagesController],
  providers: [MessagesService, ChatGateway],
  exports: [MessagesService],
})
export class MessagesModule {}
