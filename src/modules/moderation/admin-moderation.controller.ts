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
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { ResponseMessage } from "../../common/decorators/customize.decorator";
import { CheckPolicies } from "../authorization/decorators/check-policies.decorator";
import { GetAuthorizationContext } from "../authorization/decorators/get-authorization-context.decorator";
import type { AuthenticatedContext } from "../authorization/authorization.types";
import {
  CreateRestrictionDto,
  CreateWarningDto,
  LiftRestrictionDto,
  ModerationHistoryQueryDto,
  RestrictionListQueryDto,
  WarningListQueryDto,
} from "./dto/moderation.dto";
import { ModerationService } from "./moderation.service";

/**
 * Admin moderation API. Routes follow the existing `admin/...` convention
 * (see ReportsController). Every route is gated by CASL; the service repeats
 * the route check and enforces resource rules (no self create/lift).
 */
@ApiTags("Admin Moderation")
@ApiBearerAuth("access-token")
@ApiUnauthorizedResponse({ description: "Missing or invalid access token" })
@ApiForbiddenResponse({ description: "Admin only" })
@Controller("admin/moderation")
export class AdminModerationController {
  constructor(private readonly moderation: ModerationService) {}

  @Post("warnings")
  @HttpCode(HttpStatus.CREATED)
  @CheckPolicies({ action: "create", subject: "UserWarning" })
  @ApiOperation({ summary: "Issue a violation warning (does not block posting)" })
  @ResponseMessage("Warning issued successfully")
  createWarning(
    @Body() dto: CreateWarningDto,
    @GetAuthorizationContext() ctx: AuthenticatedContext,
  ) {
    return this.moderation.adminCreateWarning(ctx, dto);
  }

  @Get("warnings")
  @CheckPolicies({ action: "read", subject: "UserWarning" })
  @ApiOperation({ summary: "List warnings (filter, paginate, sort)" })
  @ResponseMessage("Warnings retrieved successfully")
  listWarnings(
    @Query() query: WarningListQueryDto,
    @GetAuthorizationContext() ctx: AuthenticatedContext,
  ) {
    return this.moderation.listWarnings(ctx, query);
  }

  @Get("users/:userId/warnings")
  @CheckPolicies({ action: "read", subject: "UserWarning" })
  @ApiOperation({ summary: "Warning history of one user" })
  @ResponseMessage("Warnings retrieved successfully")
  listUserWarnings(
    @Param("userId", new ParseUUIDPipe()) userId: string,
    @Query() query: ModerationHistoryQueryDto,
    @GetAuthorizationContext() ctx: AuthenticatedContext,
  ) {
    return this.moderation.listUserWarnings(ctx, userId, query);
  }

  @Post("restrictions")
  @HttpCode(HttpStatus.CREATED)
  @CheckPolicies({ action: "create", subject: "PostingRestriction" })
  @ApiOperation({ summary: "Create a temporary or permanent posting restriction" })
  @ResponseMessage("Posting restriction created successfully")
  createRestriction(
    @Body() dto: CreateRestrictionDto,
    @GetAuthorizationContext() ctx: AuthenticatedContext,
  ) {
    return this.moderation.adminCreateRestriction(ctx, dto);
  }

  @Get("restrictions")
  @CheckPolicies({ action: "read", subject: "PostingRestriction" })
  @ApiOperation({ summary: "List posting restrictions (filter by status/type)" })
  @ResponseMessage("Posting restrictions retrieved successfully")
  listRestrictions(
    @Query() query: RestrictionListQueryDto,
    @GetAuthorizationContext() ctx: AuthenticatedContext,
  ) {
    return this.moderation.listRestrictions(ctx, query);
  }

  @Get("users/:userId/restrictions")
  @CheckPolicies({ action: "read", subject: "PostingRestriction" })
  @ApiOperation({ summary: "Posting restriction history of one user" })
  @ResponseMessage("Posting restrictions retrieved successfully")
  listUserRestrictions(
    @Param("userId", new ParseUUIDPipe()) userId: string,
    @Query() query: ModerationHistoryQueryDto,
    @GetAuthorizationContext() ctx: AuthenticatedContext,
  ) {
    return this.moderation.listUserRestrictions(ctx, userId, query);
  }

  @Get("restrictions/:id")
  @CheckPolicies({ action: "read", subject: "PostingRestriction" })
  @ApiOperation({ summary: "Posting restriction detail" })
  @ResponseMessage("Posting restriction retrieved successfully")
  getRestriction(
    @Param("id", new ParseUUIDPipe()) id: string,
    @GetAuthorizationContext() ctx: AuthenticatedContext,
  ) {
    return this.moderation.getRestriction(ctx, id);
  }

  @Patch("restrictions/:id/lift")
  @CheckPolicies({ action: "lift", subject: "PostingRestriction" })
  @ApiOperation({
    summary: "Lift an ACTIVE or SCHEDULED restriction (EXPIRED/LIFTED → 400)",
  })
  @ResponseMessage("Posting restriction lifted successfully")
  liftRestriction(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: LiftRestrictionDto,
    @GetAuthorizationContext() ctx: AuthenticatedContext,
  ) {
    return this.moderation.adminLiftRestriction(ctx, id, dto.liftReason);
  }
}
