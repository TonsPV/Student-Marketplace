import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsOptional, IsUUID } from "class-validator";
import { PaginationDto } from "../../../common/dto/pagination.dto";
import { ReputationLevel } from "../../reviews/reputation-level";
import { PostSort } from "./post-sort";

export class FindPostsDto extends PaginationDto {
  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ enum: ReputationLevel })
  @IsOptional()
  @IsEnum(ReputationLevel)
  reputationLevel?: ReputationLevel;

  @ApiPropertyOptional({ enum: PostSort, default: PostSort.RECOMMENDED })
  @IsOptional()
  @IsEnum(PostSort)
  sort?: PostSort = PostSort.RECOMMENDED;
}
