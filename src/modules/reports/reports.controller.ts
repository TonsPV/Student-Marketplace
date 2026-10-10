import {
  Body,
  Controller,
  Get,
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
import { CreateReportDto } from "./dto/create-report.dto";
import { FilterReportDto } from "./dto/filter-report.dto";
import { HandleReportDto } from "./dto/handle-report.dto";
import { ReportsService } from "./reports.service";

@ApiTags("Reports")
@Controller()
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Post("reports")
  @CheckPolicies({ action: "create", subject: "Report" })
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Submit a report for a post or user" })
  @ResponseMessage("Report submitted successfully")
  createReport(
    @Body() dto: CreateReportDto,
    @GetAuthorizationContext() ctx: AuthenticatedContext,
  ) {
    return this.reportsService.createReport(dto, ctx);
  }

  @Get("admin/reports")
  @CheckPolicies({ action: "read", subject: "Report" })
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "List all reports (admin)" })
  @ResponseMessage("Reports retrieved successfully")
  findAll(
    @Query() query: FilterReportDto,
    @GetAuthorizationContext() ctx: AuthenticatedContext,
  ) {
    return this.reportsService.findAllForAdmin(query, ctx);
  }

  @Get("admin/reports/:id")
  @CheckPolicies({ action: "read", subject: "Report" })
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Get report details (admin)" })
  @ResponseMessage("Report retrieved successfully")
  findOne(
    @Param("id", new ParseUUIDPipe()) id: string,
    @GetAuthorizationContext() ctx: AuthenticatedContext,
  ) {
    return this.reportsService.findOneForAdmin(id, ctx);
  }

  @Patch("admin/reports/:id/action")
  @CheckPolicies({ action: "resolve", subject: "Report" })
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Handle a report action (admin)" })
  @ResponseMessage("Report handled successfully")
  handleAction(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: HandleReportDto,
    @GetAuthorizationContext() ctx: AuthenticatedContext,
  ) {
    return this.reportsService.handleAction(id, dto, ctx);
  }
}
