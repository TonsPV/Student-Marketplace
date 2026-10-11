import { Transform } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
} from "class-validator";

export class RegisterUserDto {
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
  @IsEmail({}, { message: "Email is not valid" })
  @IsNotEmpty({ message: "Email cannot be empty" })
  email!: string;

  @ApiProperty()
  @IsNotEmpty({ message: "Password cannot be empty" })
  @IsString()
  @Length(8, 20)
  password!: string;

  @ApiProperty()
  @IsNotEmpty({ message: "DisplayName cannot be empty" })
  @IsString()
  @Length(2, 50)
  fullName!: string;

  @ApiProperty()
  @IsNotEmpty({ message: "Phone cannot be empty" })
  @Length(10, 15)
  phone!: string;
}
