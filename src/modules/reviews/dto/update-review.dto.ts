import { Transform } from "class-transformer";
import { ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateIf,
} from "class-validator";

export class UpdateReviewDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 5, example: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @ApiPropertyOptional({
    example: "Updated comment.",
    nullable: true,
    description: "Set to null to clear the existing comment.",
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @ValidateIf(
    (_object, value: unknown) => value !== undefined && value !== null,
  )
  @IsString()
  @IsNotEmpty()
  @Length(1, 5000)
  comment?: string | null;
}
