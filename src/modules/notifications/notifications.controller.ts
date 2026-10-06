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
import {
  GetUser,
  ResponseMessage,
} from "../../common/decorators/customize.decorator";
import { PaginationDto } from "../../common/dto/pagination.dto";
import type { UserInterface } from "../../shared/interfaces/user.interface";
import { NotificationsService } from "./notifications.service";

@ApiTags("Notifications")
@ApiBearerAuth("access-token")
@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: "List notifications (kèm snapshots đồng bộ)" })
  @ResponseMessage("Notifications retrieved successfully")
  getList(@GetUser() user: UserInterface, @Query() query: PaginationDto) {
    return this.notificationsService.getList(user.id, query);
  }

  @Get("unread-count")
  @ApiOperation({ summary: "Đếm notification chưa đọc" })
  @ResponseMessage("Unread count retrieved successfully")
  getUnreadCount(@GetUser() user: UserInterface) {
    return this.notificationsService.getUnreadCount(user.id);
  }

  @Patch("read-all")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Đánh dấu tất cả notification đã đọc" })
  @ResponseMessage("Notifications marked as read")
  markAllAsRead(@GetUser() user: UserInterface) {
    return this.notificationsService.markAllAsRead(user.id);
  }

  @Patch(":id/read")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Đánh dấu một notification đã đọc" })
  @ResponseMessage("Notification marked as read")
  markOneAsRead(
    @Param("id", new ParseUUIDPipe()) id: string,
    @GetUser() user: UserInterface,
  ) {
    return this.notificationsService.markOneAsRead(user.id, id);
  }
}
