import { ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
} from "class-validator";
import { POST_IMAGE_KEY_REGEX } from "../../storage/storage.constants";

export class CreatePostImageDto {
  @ApiPropertyOptional({
    description:
      "R2 object key returned by uploads/presign with purpose post. Send key OR url.",
  })
  @IsOptional()
  @IsString()
  @Matches(POST_IMAGE_KEY_REGEX)
  key?: string;

  @ApiPropertyOptional({
    example: "https://cdn.example.com/posts/book-1.jpg",
    description: "Legacy external image URL. Send url OR key.",
  })
  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(2048)
  url?: string;
}
