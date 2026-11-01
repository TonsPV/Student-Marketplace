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
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { ResponseMessage } from "../../common/decorators/customize.decorator";
import { CheckPolicies } from "../authorization/decorators/check-policies.decorator";
import { GetAuthorizationContext } from "../authorization/decorators/get-authorization-context.decorator";
import type { AuthenticatedContext } from "../authorization/authorization.types";
import { CreatePostPromotionDto } from "./dto/post-promotion.dto";
import { PostPromotionsService } from "./post-promotions.service";

/**
 * Admin promotion management (Phase 4 Step 2). Follows the `admin/...`
 * convention of AdminModerationController: every route is CASL-gated and
 * the service repeats the route check. No Admin UI and no payment flow in
 * this scope; fixtures/seeds may also insert rows directly for tests.
 */
@ApiTags("Admin Post Promotions")
@ApiBearerAuth("access-token")
@ApiUnauthorizedResponse({ description: "Missing or invalid access token" })
@ApiForbiddenResponse({ description: "Admin only" })
@Controller("admin/posts")
export class AdminPostPromotionsController {
  constructor(private readonly promotions: PostPromotionsService) {}

  @Post(":postId/promotions")
  @HttpCode(HttpStatus.CREATED)
  @CheckPolicies({ action: "create", subject: "PostPromotion" })
  @ResponseMessage("Post promotion created successfully")
  create(
    @Param("postId", new ParseUUIDPipe()) postId: string,
    @Body() dto: CreatePostPromotionDto,
    @GetAuthorizationContext() ctx: AuthenticatedContext,
  ) {
    return this.promotions.adminCreate(ctx, postId, dto);
  }

  @Get(":postId/promotions")
  @CheckPolicies({ action: "read", subject: "PostPromotion" })
  @ResponseMessage("Post promotions retrieved successfully")
  list(
    @Param("postId", new ParseUUIDPipe()) postId: string,
    @GetAuthorizationContext() ctx: AuthenticatedContext,
  ) {
    return this.promotions.adminList(ctx, postId);
  }

  @Patch(":postId/promotions/:promotionId/cancel")
  @CheckPolicies({ action: "cancel", subject: "PostPromotion" })
  @ResponseMessage("Post promotion cancelled successfully")
  cancel(
    @Param("postId", new ParseUUIDPipe()) postId: string,
    @Param("promotionId", new ParseUUIDPipe()) promotionId: string,
    @GetAuthorizationContext() ctx: AuthenticatedContext,
  ) {
    return this.promotions.adminCancel(ctx, postId, promotionId);
  }
}
