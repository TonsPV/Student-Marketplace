import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  GetUser,
  ResponseMessage,
} from "../../common/decorators/customize.decorator";
import type { UserInterface } from "../../shared/interfaces/user.interface";
import { MessagesService } from "./messages.service";
import { SendMessageDto } from "./dto/send-message.dto";

@ApiTags("Messages")
@ApiBearerAuth("access-token")
@Controller("messages")
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      "Gửi tin nhắn (mở chat bằng postId hoặc reply bằng conversationId)",
  })
  @ResponseMessage("Message sent successfully")
  sendMessage(@Body() dto: SendMessageDto, @GetUser() user: UserInterface) {
    return this.messagesService.sendMessage(user.id, dto);
  }

  @Get("unread-count")
  @ApiOperation({ summary: "Đếm tin chưa đọc (tổng + số conversation)" })
  @ResponseMessage("Unread count retrieved successfully")
  getUnreadCount(@GetUser() user: UserInterface) {
    return this.messagesService.getUnreadCount(user.id);
  }
}
