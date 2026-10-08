import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ResponseMessage } from "../../common/decorators/customize.decorator";
import { CheckPolicies } from "../authorization/decorators/check-policies.decorator";
import { GetAuthorizationContext } from "../authorization/decorators/get-authorization-context.decorator";
import type { AuthenticatedContext } from "../authorization/authorization.types";
import { MessagesService } from "./messages.service";
import { SendMessageDto } from "./dto/send-message.dto";

@ApiTags("Messages")
@ApiBearerAuth("access-token")
@Controller("messages")
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Post()
  @CheckPolicies({ action: "sendMessage", subject: "Conversation" })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      "G?i tin nh?n (m? chat b?ng postId ho?c reply b?ng conversationId)",
  })
  @ResponseMessage("Message sent successfully")
  sendMessage(
    @Body() dto: SendMessageDto,
    @GetAuthorizationContext() ctx: AuthenticatedContext,
  ) {
    return this.messagesService.sendMessage(ctx, dto);
  }

  @Get("unread-count")
  @CheckPolicies({ action: "readMessages", subject: "Conversation" })
  @ApiOperation({ summary: "�?m tin chua d?c (t?ng + s? conversation)" })
  @ResponseMessage("Unread count retrieved successfully")
  getUnreadCount(@GetAuthorizationContext() ctx: AuthenticatedContext) {
    return this.messagesService.getUnreadCount(ctx);
  }
}
