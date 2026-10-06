import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
import type { UserInterface } from "../../shared/interfaces/user.interface";
import { MessagesService } from "./messages.service";
import {
  GetMessagesQueryDto,
  MarkReadDto,
  SendConversationMessageDto,
} from "./dto/send-message.dto";

/**
 * Route alias theo conversation. POST là alias deprecated của E1 (DTO body
 * riêng, clientId optional); history/read là contract cursor/watermark mới.
 */
@ApiTags("Conversation messages")
@ApiBearerAuth("access-token")
@Controller("conversations/:id")
export class ConversationMessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Get("messages")
  @ApiOperation({ summary: "Lịch sử tin nhắn (cursor before, mới → cũ)" })
  @ResponseMessage("Messages retrieved successfully")
  findMessages(
    @Param("id", new ParseUUIDPipe()) id: string,
    @GetUser() user: UserInterface,
    @Query() query: GetMessagesQueryDto,
  ) {
    return this.messagesService.findMessages(id, user.id, query);
  }

  @Post("messages")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: "[Deprecated] Gửi tin trong conversation (dùng POST /messages)",
    deprecated: true,
  })
  @ResponseMessage("Message sent successfully")
  sendMessage(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: SendConversationMessageDto,
    @GetUser() user: UserInterface,
  ) {
    return this.messagesService.sendConversationMessage(id, user.id, dto);
  }

  @Patch("read")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Đánh dấu đã đọc tới throughMessageId" })
  @ResponseMessage("Messages marked as read")
  markAsRead(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: MarkReadDto,
    @GetUser() user: UserInterface,
  ) {
    return this.messagesService.markAsRead(id, user.id, dto);
  }
}
