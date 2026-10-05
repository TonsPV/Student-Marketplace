import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsNotEmpty, IsString, Length } from "class-validator";


export class RegisterUserDto {
    @ApiProperty()
    @IsEmail({}, { message: 'Email is not valid' })
    @IsNotEmpty({ message: 'Email cannot be empty' })
    email!: string;

    @ApiProperty()
    @IsNotEmpty({ message: 'Password cannot be empty' })
    @IsString()
    @Length(8, 20)
    password!: string;

    @ApiProperty()
    @IsNotEmpty({ message: 'DisplayName cannot be empty' })
    @IsString()
    @Length(2, 50)
    fullName!: string;

    @ApiProperty()
    @IsNotEmpty({ message: 'Phone cannot be empty' })
    @Length(10, 15)
    phone!: string;
}