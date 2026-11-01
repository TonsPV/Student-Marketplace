import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsEnum,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from "class-validator";
import { PaginationDto } from "../../../common/dto/pagination.dto";
import {
  PostingRestrictionType,
  RestrictionStatus,
} from "../posting-restriction.rules";

export const MODERATION_REASON_MAX = 1000;
/** D4: an explicit offset is required so the instant is unambiguous. */
const OFFSET = /(Z|[+-]\d{2}:\d{2})$/;
const NOT_BLANK = /\S/;

/** Shared decorators: strict ISO 8601 instant with `Z` or `±HH:mm`. */
function IsInstant(): PropertyDecorator {
  return (target, key) => {
    IsString()(target, key);
    IsISO8601({ strict: true, strictSeparator: true })(target, key);
    Matches(OFFSET, {
      message: `${String(key)} must include a timezone (Z or ±HH:mm)`,
    })(target, key);
  };
}

/** D3: required, not only whitespace, at most 1000 characters. */
export function IsModerationReason(): PropertyDecorator {
  return (target, key) => {
    IsString()(target, key);
    Matches(NOT_BLANK, { message: `${String(key)} must not be blank` })(
      target,
      key,
    );
    MaxLength(MODERATION_REASON_MAX)(target, key);
  };
}

export class CreateWarningDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  userId!: string;

  @ApiProperty({ maxLength: MODERATION_REASON_MAX })
  @IsModerationReason()
  reason!: string;

  @ApiPropertyOptional({ format: "uuid", nullable: true })
  @IsOptional()
  @IsUUID()
  sourceReportId?: string | null;
}

export class CreateRestrictionDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  userId!: string;

  @ApiProperty({ enum: PostingRestrictionType })
  @IsEnum(PostingRestrictionType)
  type!: PostingRestrictionType;

  @ApiProperty({ maxLength: MODERATION_REASON_MAX })
  @IsModerationReason()
  reason!: string;

  @ApiPropertyOptional({
    format: "date-time",
    description: "Defaults to now. Must include Z or ±HH:mm.",
  })
  @IsOptional()
  @IsInstant()
  startsAt?: string;

  @ApiPropertyOptional({
    format: "date-time",
    nullable: true,
    description: "Required for TEMPORARY; omit or null for PERMANENT.",
  })
  @IsOptional()
  @IsInstant()
  expiresAt?: string | null;

  @ApiPropertyOptional({ format: "uuid", nullable: true })
  @IsOptional()
  @IsUUID()
  sourceReportId?: string | null;
}

export class LiftRestrictionDto {
  @ApiProperty({ maxLength: MODERATION_REASON_MAX })
  @IsModerationReason()
  liftReason!: string;
}

export enum SortOrder {
  DESC = "DESC",
  ASC = "ASC",
}

/** Per-user history: pagination + createdAt order only. */
export class ModerationHistoryQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: SortOrder, default: SortOrder.DESC })
  @IsOptional()
  @IsIn(Object.values(SortOrder))
  order: SortOrder = SortOrder.DESC;
}

export class WarningListQueryDto extends ModerationHistoryQueryDto {
  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  issuedById?: string;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  sourceReportId?: string;

  @ApiPropertyOptional({
    format: "date-time",
    description: "Inclusive lower bound on createdAt.",
  })
  @IsOptional()
  @IsInstant()
  createdFrom?: string;

  @ApiPropertyOptional({
    format: "date-time",
    description: "Exclusive upper bound on createdAt.",
  })
  @IsOptional()
  @IsInstant()
  createdTo?: string;
}

export class RestrictionListQueryDto extends WarningListQueryDto {
  @ApiPropertyOptional({ enum: PostingRestrictionType })
  @IsOptional()
  @IsEnum(PostingRestrictionType)
  type?: PostingRestrictionType;

  @ApiPropertyOptional({ enum: RestrictionStatus })
  @IsOptional()
  @IsEnum(RestrictionStatus)
  status?: RestrictionStatus;
}
