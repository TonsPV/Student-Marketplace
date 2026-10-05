import { IsEnum, IsNotEmpty, IsOptional, IsString } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export enum HandleReportAction {
  DISMISS = "DISMISS",
  RESOLVE_HIDE_POST = "RESOLVE_HIDE_POST",
  RESOLVE_BAN_USER = "RESOLVE_BAN_USER",
}

export class HandleReportDto {
  @ApiProperty({ enum: HandleReportAction })
  @IsEnum(HandleReportAction)
  @IsNotEmpty()
  action!: HandleReportAction;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  adminNote?: string;
}
