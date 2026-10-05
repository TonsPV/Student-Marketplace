import { IsNotEmpty, IsUUID } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class CreateConversationDto {
  @ApiProperty({
    description: "UUID of the post to start a conversation about",
  })
  @IsUUID()
  @IsNotEmpty()
  postId!: string;
}
