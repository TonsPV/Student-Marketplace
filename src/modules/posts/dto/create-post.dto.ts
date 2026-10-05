import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsEnum,
  IsIn,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  ValidateNested,
} from "class-validator";
import { PostCondition } from "../post.entity";

class LocationDto {
  @IsIn(["Point"])
  type!: "Point";

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(2)
  @IsNumber({}, { each: true })
  coordinates!: [number, number]; // [longitude, latitude]
}

export class CreatePostDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  categoryId!: string;

  @ApiProperty({ example: "Sách Giải tích 1" })
  @IsString()
  @Length(5, 150)
  title!: string;

  @ApiProperty({ example: "Sách còn mới, có ghi chú bằng bút chì." })
  @IsString()
  @Length(20, 5000)
  description!: string;

  @ApiProperty({
    example: "50000",
    description: "Price in VND. Send an integer as a string to avoid floating-point errors.",
  })
  @IsString()
  @Matches(/^\d+$/, {
    message: "price must be a non-negative integer",
  })
  price!: string;

  @ApiProperty({ enum: PostCondition, example: PostCondition.LIKE_NEW })
  @IsEnum(PostCondition)
  condition!: PostCondition;

  @ApiPropertyOptional({
    example: { type: "Point", coordinates: [106.7009, 10.7769] },
    description: "GeoJSON Point: coordinates are [longitude, latitude].",
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocationDto)
  location?: LocationDto;
}
