import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ResponseMessage } from "../../common/decorators/customize.decorator";
import { CheckPolicies } from "../authorization/decorators/check-policies.decorator";
import { GetAuthorizationContext } from "../authorization/decorators/get-authorization-context.decorator";
import type { AuthenticatedContext } from "../authorization/authorization.types";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { NotificationsService } from "./notifications.service";

@ApiTags("Notifications")
@ApiBearerAuth("access-token")
@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @CheckPolicies({ action: "read", subject: "Notification" })
  @ApiOperation({ summary: "List notifications" })
  @ResponseMessage("Notifications retrieved successfully")
  getList(
    @GetAuthorizationContext() ctx: AuthenticatedContext,
    @Query() query: PaginationDto,
  ) {
    return this.notificationsService.getList(ctx, query);
  }

  @Get("unread-count")
  @CheckPolicies({ action: "read", subject: "Notification" })
  @ApiOperation({ summary: "Count unread notifications" })
  @ResponseMessage("Unread count retrieved successfully")
  getUnreadCount(@GetAuthorizationContext() ctx: AuthenticatedContext) {
    return this.notificationsService.getUnreadCount(ctx);
  }

  @Patch("read-all")
  @CheckPolicies({ action: "markRead", subject: "Notification" })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Mark all notifications as read" })
  @ResponseMessage("Notifications marked as read")
  markAllAsRead(@GetAuthorizationContext() ctx: AuthenticatedContext) {
    return this.notificationsService.markAllAsRead(ctx);
  }

  @Patch(":id/read")
  @CheckPolicies({ action: "markRead", subject: "Notification" })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Mark one notification as read" })
  @ResponseMessage("Notification marked as read")
  markOneAsRead(
    @Param("id", new ParseUUIDPipe()) id: string,
    @GetAuthorizationContext() ctx: AuthenticatedContext,
  ) {
    return this.notificationsService.markOneAsRead(ctx, id);
  }
}
