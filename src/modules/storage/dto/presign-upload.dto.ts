import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsInt, IsString, Min } from "class-validator";
import {
  MESSAGE_IMAGE_CONTENT_TYPES,
  SUPPORTED_UPLOAD_PURPOSES,
} from "../storage.constants";

/**
 * Phase 1 chỉ hỗ trợ purpose 'message'. Các purpose khác (post/avatar)
 * migrate riêng khi có spec consumer (spec §10.2, §10.5).
 */
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
