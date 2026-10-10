import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsInt, IsString, Min } from "class-validator";
import {
  MESSAGE_IMAGE_CONTENT_TYPES,
  SUPPORTED_UPLOAD_PURPOSES,
} from "../storage.constants";

/** Upload directly to R2, then attach the returned key to a message or post. */
export class PresignUploadDto {
  @ApiProperty({ enum: SUPPORTED_UPLOAD_PURPOSES, example: "message" })
  @IsString()
  @IsIn([...SUPPORTED_UPLOAD_PURPOSES])
  purpose!: string;

  @ApiProperty({
    enum: MESSAGE_IMAGE_CONTENT_TYPES,
    example: "image/jpeg",
  })
  @IsString()
  @IsIn([...MESSAGE_IMAGE_CONTENT_TYPES])
  contentType!: string;

  @ApiProperty({ example: 1048576, description: "Kích thước file (bytes)" })
  @IsInt()
  @Min(1)
  size!: number;
}
