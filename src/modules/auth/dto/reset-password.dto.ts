import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsNumberString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class SendResetPasswordDto {
  @ApiProperty()
  @IsEmail({}, { message: 'Email is invalid' })
  @IsNotEmpty({ message: 'Email is required' })
  email!: string;
}

export class VerifyOtpDto {
  @ApiProperty()
  @IsEmail({}, { message: 'Email is invalid' })
  @IsNotEmpty({ message: 'Email is required' })
  email!: string;

  @ApiProperty()
  @MinLength(6, { message: 'OTP must be at least 6 characters long' })
  @MaxLength(6, { message: 'OTP cannot exceed 6 characters' })
  @IsNotEmpty({ message: 'OTP is required' })
  @IsNumberString()
  otp!: string;
}

export class ResetPasswordDto {
  @ApiProperty()
  @IsEmail({}, { message: 'Email is invalid' })
  @IsNotEmpty({ message: 'Email is required' })
  email!: string;

  @ApiProperty()
  @MinLength(6, { message: 'OTP must be at least 6 characters long' })
  @MaxLength(6, { message: 'OTP cannot exceed 6 characters' })
  @IsNotEmpty({ message: 'OTP is required' })
  @IsNumberString()
  otp!: string;

  @ApiProperty()
  @IsNotEmpty({ message: 'New password is required' })
  @MinLength(8, { message: 'New password must be at least 8 characters long' })
  newPassword!: string;
}
