import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsISO8601, IsOptional, IsString, Matches } from "class-validator";

/** Same convention as moderation DTOs: strict ISO 8601 with an explicit offset. */
const OFFSET = /(Z|[+-]\d{2}:\d{2})$/;

function IsInstant(): PropertyDecorator {
  return (target, key) => {
    IsString()(target, key);
    IsISO8601({ strict: true, strictSeparator: true })(target, key);
    Matches(OFFSET, {
      message: `${String(key)} must include a timezone (Z or ±HH:mm)`,
    })(target, key);
  };
}

/**
 * Admin-managed promotion window. `startsAt` defaults to "now" so a
 * promotion created without it is immediately active. Timestamps must
 * include a timezone; the lifecycle is derived, there is no status column.
 */
export class CreatePostPromotionDto {
  @ApiPropertyOptional({
    format: "date-time",
    description: "When the promotion becomes active. Defaults to now.",
  })
  @IsOptional()
  @IsInstant()
  startsAt?: string;

  @ApiProperty({ format: "date-time" })
  @IsInstant()
  endsAt!: string;
}
