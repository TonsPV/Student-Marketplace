import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsUUID } from "class-validator";
import { PaginationDto } from "../../../common/dto/pagination.dto";

export class FindPostsDto extends PaginationDto {
  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  categoryId?: string;
}
