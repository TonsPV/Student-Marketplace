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
import { ResponseMessage } from "../../common/decorators/customize.decorator";
import { CheckPolicies } from "../authorization/decorators/check-policies.decorator";
import { GetAuthorizationContext } from "../authorization/decorators/get-authorization-context.decorator";
import type { AuthenticatedContext } from "../authorization/authorization.types";
import { MessagesService } from "./messages.service";
import {
  GetMessagesQueryDto,
  MarkReadDto,
  SendConversationMessageDto,
} from "./dto/send-message.dto";

@ApiTags("Conversation messages")
@ApiBearerAuth("access-token")
@Controller("conversations/:id")
export class ConversationMessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Get("messages")
  @CheckPolicies({ action: "readMessages", subject: "Conversation" })
  @ApiOperation({ summary: "List messages (cursor based)" })
  @ResponseMessage("Messages retrieved successfully")
  findMessages(
    @Param("id", new ParseUUIDPipe()) id: string,
    @GetAuthorizationContext() ctx: AuthenticatedContext,
    @Query() query: GetMessagesQueryDto,
  ) {
    return this.messagesService.findMessages(id, ctx, query);
  }

  @Post("messages")
  @CheckPolicies({ action: "sendMessage", subject: "Conversation" })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: "[Deprecated] Send message in conversation",
    deprecated: true,
  })
  @ResponseMessage("Message sent successfully")
  sendMessage(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: SendConversationMessageDto,
    @GetAuthorizationContext() ctx: AuthenticatedContext,
  ) {
    return this.messagesService.sendConversationMessage(id, ctx, dto);
  }

  @Patch("read")
  @CheckPolicies({ action: "markRead", subject: "Conversation" })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Mark messages as read up to throughMessageId" })
  @ResponseMessage("Messages marked as read")
  markAsRead(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: MarkReadDto,
    @GetAuthorizationContext() ctx: AuthenticatedContext,
  ) {
    return this.messagesService.markAsRead(id, ctx, dto);
  }
}
