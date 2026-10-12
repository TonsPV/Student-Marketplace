import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional } from "class-validator";
import { FindPostsDto } from "./find-posts.dto";
import { PostStatus } from "../post.entity";

export class FindMyPostsDto extends FindPostsDto {
  @ApiPropertyOptional({ enum: PostStatus })
  @IsOptional()
  @IsIn(Object.values(PostStatus))
  status?: PostStatus;

  @ApiPropertyOptional({
    enum: ["true", "false"],
    description:
      "true lists only your soft-deleted posts; false or omission lists existing posts.",
  })
  @IsOptional()
  @IsIn(["true", "false"])
  deleted?: "true" | "false";
}
