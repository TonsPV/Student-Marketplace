import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Body,
  Query,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ResponseMessage } from "../../common/decorators/customize.decorator";
import { CheckPolicies } from "../authorization/decorators/check-policies.decorator";
import { GetAuthorizationContext } from "../authorization/decorators/get-authorization-context.decorator";
import type { AuthenticatedContext } from "../authorization/authorization.types";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { ConversationsService } from "./conversations.service";
import { CreateConversationDto } from "./dto/create-conversation.dto";

@ApiTags("Conversations")
@ApiBearerAuth("access-token")
@Controller("conversations")
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Post()
  @CheckPolicies({ action: "create", subject: "Conversation" })
  @ApiOperation({ summary: "Create or retrieve a conversation for a post" })
  @ResponseMessage("Conversation created successfully")
  createConversation(
    @Body() dto: CreateConversationDto,
    @GetAuthorizationContext() ctx: AuthenticatedContext,
  ) {
    return this.conversationsService.createConversation(dto, ctx);
  }

  @Get()
  @CheckPolicies({ action: "read", subject: "Conversation" })
  @ApiOperation({ summary: "List conversations for the current user" })
  @ResponseMessage("Conversations retrieved successfully")
  findAll(
    @GetAuthorizationContext() ctx: AuthenticatedContext,
    @Query() query: PaginationDto,
  ) {
    return this.conversationsService.findAll(ctx, query);
  }

  @Get(":id")
  @CheckPolicies({ action: "read", subject: "Conversation" })
  @ApiOperation({ summary: "Get conversation detail" })
  @ResponseMessage("Conversation retrieved successfully")
  findOne(
    @Param("id", new ParseUUIDPipe()) id: string,
    @GetAuthorizationContext() ctx: AuthenticatedContext,
  ) {
    return this.conversationsService.findOne(id, ctx);
  }
}
