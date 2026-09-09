import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty()
  @IsNotEmpty({ message: 'Old password is required' })
  @IsString()
  oldPassword!: string;

  @ApiProperty()
  @IsNotEmpty({ message: 'New password is required' })
  @IsString()
  @MinLength(8, { message: 'New password must be at least 8 characters long' })
  newPassword!: string;

  @ApiProperty()
  @IsNotEmpty({ message: 'Confirm password is required' })
  @IsString()
  confirmPassword!: string;
}
