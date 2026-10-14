import { ApiProperty } from "@nestjs/swagger";
import { IsUUID, ValidateIf } from "class-validator";

export class MarkPostSoldDto {
  @ApiProperty({
    format: "uuid",
    nullable: true,
    description: "Buyer on the platform, or null for an off-platform sale",
  })
  @ValidateIf((value) => value.buyerId !== null && value.buyerId !== undefined)
  @IsUUID()
  buyerId!: string | null;
}
