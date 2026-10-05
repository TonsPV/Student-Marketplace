import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";

import {
  GetUser,
  ResponseMessage,
} from "../../common/decorators/customize.decorator";
import { AdminGuard } from "../../common/guards/admin.guard";
import { UserInterface } from "../../shared/interfaces/user.interface";
import { CreateReportDto } from "./dto/create-report.dto";
import { FilterReportDto } from "./dto/filter-report.dto";
import { HandleReportDto } from "./dto/handle-report.dto";
import { ReportsService } from "./reports.service";

@ApiTags("Reports")
@Controller()
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  // ── User routes ──────────────────────────────────────────────────────────────

  @Post("reports")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Submit a report for a post or user" })
  @ResponseMessage("Report submitted successfully")
  createReport(
    @Body() dto: CreateReportDto,
    @GetUser() user: UserInterface,
  ) {
    return this.reportsService.createReport(dto, user.id);
  }

  // ── Admin routes ─────────────────────────────────────────────────────────────

  @Get("admin/reports")
  @UseGuards(AdminGuard)
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "List all reports (admin)" })
  @ResponseMessage("Reports retrieved successfully")
  findAll(@Query() query: FilterReportDto) {
    return this.reportsService.findAllForAdmin(query);
  }

  @Get("admin/reports/:id")
  @UseGuards(AdminGuard)
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Get report details (admin)" })
  @ResponseMessage("Report retrieved successfully")
  findOne(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.reportsService.findOneForAdmin(id);
  }

  @Patch("admin/reports/:id/action")
  @UseGuards(AdminGuard)
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Handle a report action (admin)" })
  @ResponseMessage("Report handled successfully")
  handleAction(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: HandleReportDto,
    @GetUser() user: UserInterface,
  ) {
    return this.reportsService.handleAction(id, dto, user.id);
  }
}
