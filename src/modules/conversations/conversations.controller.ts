import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";

import {
  GetUser,
  ResponseMessage,
} from "../../common/decorators/customize.decorator";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { UserInterface } from "../../shared/interfaces/user.interface";
import { ConversationsService } from "./conversations.service";
import { CreateConversationDto } from "./dto/create-conversation.dto";
import { SendMessageDto } from "./dto/send-message.dto";

@ApiTags("Conversations")
@ApiBearerAuth("access-token")
@Controller("conversations")
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Post()
  @ApiOperation({ summary: "Create or retrieve a conversation for a post" })
  @ResponseMessage("Conversation created successfully")
  createConversation(
    @Body() dto: CreateConversationDto,
    @GetUser() user: UserInterface,
  ) {
    return this.conversationsService.createConversation(dto, user.id);
  }

  @Get()
  @ApiOperation({ summary: "List conversations for the current user" })
  @ResponseMessage("Conversations retrieved successfully")
  findAll(@GetUser() user: UserInterface, @Query() query: PaginationDto) {
    return this.conversationsService.findAll(user.id, query);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get conversation detail" })
  @ResponseMessage("Conversation retrieved successfully")
  findOne(
    @Param("id", new ParseUUIDPipe()) id: string,
    @GetUser() user: UserInterface,
  ) {
    return this.conversationsService.findOne(id, user.id);
  }

  @Get(":id/messages")
  @ApiOperation({ summary: "List messages in a conversation" })
  @ResponseMessage("Messages retrieved successfully")
  findMessages(
    @Param("id", new ParseUUIDPipe()) id: string,
    @GetUser() user: UserInterface,
    @Query() query: PaginationDto,
  ) {
    return this.conversationsService.findMessages(id, user.id, query);
  }

  @Post(":id/messages")
  @ApiOperation({ summary: "Send a message in a conversation" })
  @ResponseMessage("Message sent successfully")
  sendMessage(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: SendMessageDto,
    @GetUser() user: UserInterface,
  ) {
    return this.conversationsService.sendMessage(id, user.id, dto);
  }

  @Patch(":id/read")
  @ApiOperation({ summary: "Mark messages in a conversation as read" })
  @ResponseMessage("Messages marked as read")
  markAsRead(
    @Param("id", new ParseUUIDPipe()) id: string,
    @GetUser() user: UserInterface,
  ) {
    return this.conversationsService.markAsRead(id, user.id);
  }
}
