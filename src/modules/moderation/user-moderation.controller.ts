import { Controller, Get, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AuthOnly } from "../authorization/decorators/auth-only.decorator";
import { GetAuthorizationContext } from "../authorization/decorators/get-authorization-context.decorator";
import type { AuthenticatedContext } from "../authorization/authorization.types";
import { ResponseMessage } from "../../common/decorators/customize.decorator";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { ModerationService } from "./moderation.service";

@ApiTags("user moderation")
@ApiBearerAuth("access-token")
@Controller("user/me/moderation")
@AuthOnly()
export class UserModerationController {
  constructor(private readonly moderation: ModerationService) {}

  @Get("status")
  @ResponseMessage("Posting restriction status retrieved successfully")
  getStatus(@GetAuthorizationContext() context: AuthenticatedContext) {
    return this.moderation.getMyPostingRestrictionStatus(context);
  }

  @Get("restrictions")
  @ResponseMessage("Posting restriction history retrieved successfully")
  getRestrictions(
    @GetAuthorizationContext() context: AuthenticatedContext,
    @Query() query: PaginationDto,
  ) {
    return this.moderation.listMyPostingRestrictions(context, query);
  }
}
