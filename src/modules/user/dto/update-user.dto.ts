import { Transform } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, IsUrl, Length } from "class-validator";

export class UpdateUserDto {
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    minLength: 1,
    maxLength: 150,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsOptional()
  @IsString()
  @Length(1, 150)
  university?: string | null;

  @ApiProperty()
  @IsOptional()
  @IsString()
  @Length(3, 30)
  fullName!: string;

  @ApiProperty()
  @IsOptional()
  @IsString()
  @Length(10, 15)
  phone!: string;

  @ApiProperty()
  @IsOptional()
  @IsUrl()
  avatarUrl!: string;
}
