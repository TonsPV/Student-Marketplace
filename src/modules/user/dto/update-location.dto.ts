import { ApiProperty } from "@nestjs/swagger";
import { IsLatitude, IsLongitude, IsNumber } from "class-validator";

export class UpdateLocationDto {
  @ApiProperty({ example: 10.762622 })
  @IsNumber()
  @IsLatitude()
  latitude!: number;

  @ApiProperty({ example: 106.660172 })
  @IsNumber()
  @IsLongitude()
  longitude!: number;
}
