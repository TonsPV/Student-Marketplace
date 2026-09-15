import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from "class-validator";
import { PostCondition } from "../post.entity";

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
    example: "50000.00",
    description: "Send money as a string to avoid floating-point errors.",
  })
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message:
      "price must be a non-negative amount with at most 2 decimal places",
  })
  price!: string;

  @ApiProperty({ enum: PostCondition, example: PostCondition.LIKE_NEW })
  @IsEnum(PostCondition)
  condition!: PostCondition;

  @ApiPropertyOptional({ example: "POINT(106.7009 10.7769)" })
  @IsOptional()
  @IsString()
  @Matches(/^POINT\(-?\d+(\.\d+)?\s+-?\d+(\.\d+)?\)$/i, {
    message: "location must use WKT format: POINT(longitude latitude)",
  })
  location?: {
    type: "Point";
    coordinates: [number, number]; // [longitude, latitude]
  };
}
