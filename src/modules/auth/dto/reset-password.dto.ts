import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  registerDecorator,
  ValidationOptions,
} from "class-validator";

export function MaxUtf8Bytes(
  max: number,
  options?: ValidationOptions,
): PropertyDecorator {
  return (object, propertyName) =>
    registerDecorator({
      name: "maxUtf8Bytes",
      target: object.constructor,
      propertyName: String(propertyName),
      constraints: [max],
      options,
      validator: {
        validate: (value: unknown) =>
          typeof value === "string" && Buffer.byteLength(value, "utf8") <= max,
        defaultMessage: () => `Password cannot exceed ${max} UTF-8 bytes`,
      },
    });
}

export class SendResetPasswordDto {
  @ApiProperty({ example: "student@example.com" })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsString()
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class VerifyOtpDto extends SendResetPasswordDto {
  @ApiProperty({ example: "012345", description: "Exactly six ASCII digits" })
  @IsString()
  @Matches(/^[0-9]{6}$/, { message: "OTP must contain exactly six digits" })
  otp!: string;
}

export class ResetPasswordDto {
  @ApiProperty({ description: "One-use token returned by verify-reset-otp" })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  resetToken!: string;

  @ApiProperty({ minLength: 8, description: "Maximum 72 UTF-8 bytes" })
  @IsString()
  @MinLength(8)
  @MaxUtf8Bytes(72)
  newPassword!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxUtf8Bytes(72)
  confirmPassword!: string;
}
