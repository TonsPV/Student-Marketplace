import { ApiProperty } from "@nestjs/swagger";
import { IsUUID } from "class-validator";

export class CreateFavoriteDto {
  @ApiProperty({
    format: "uuid",
    description: "ID of the active post to favorite",
  })
  @IsUUID()
  postId!: string;
}
