import { Transform, Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  ValidateNested,
} from "class-validator";
import { PostCondition } from "../post.entity";
import { UpdateLocationDto } from "../../user/dto/update-location.dto";

export class CreatePostDto {
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    minLength: 1,
    maxLength: 255,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsOptional()
  @IsString()
  @Length(1, 255)
  locationName?: string | null;

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
    description:
      "Price in VND. Send an integer as a string to avoid floating-point errors.",
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
    type: UpdateLocationDto,
    example: { latitude: 10.7769, longitude: 106.7009 },
    description: "Location in degrees, using the same format as user location.",
    nullable: true,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateLocationDto)
  location?: UpdateLocationDto | null;
}
