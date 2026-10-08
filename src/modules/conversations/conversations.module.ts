import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { PostEntity } from "../posts/post.entity";
import { ConversationEntity } from "./entities/conversation.entity";
import { ConversationsController } from "./conversations.controller";
import { ConversationsService } from "./conversations.service";
import { AuthorizationModule } from "../authorization/authorization.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([ConversationEntity, PostEntity]),
    AuthorizationModule,
  ],
  controllers: [ConversationsController],
  providers: [ConversationsService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
