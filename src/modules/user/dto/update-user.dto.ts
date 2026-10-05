import { ApiProperty } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsUrl,
  Length,
  MaxLength,
} from 'class-validator';

export class UpdateUserDto {
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
