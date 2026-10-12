import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional } from "class-validator";
import { PaginationDto } from "../../../common/dto/pagination.dto";
import { PostStatus } from "../../posts/post.entity";

export class PublicUserPostsDto extends PaginationDto {
  @ApiPropertyOptional({
    enum: [PostStatus.ACTIVE, PostStatus.SOLD],
    description: "Omit to include both public statuses.",
  })
  @IsOptional()
  @IsIn([PostStatus.ACTIVE, PostStatus.SOLD])
  status?: PostStatus.ACTIVE | PostStatus.SOLD;
}
