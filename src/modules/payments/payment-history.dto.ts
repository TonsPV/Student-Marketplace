import { IsIn, IsOptional } from "class-validator";
import { PaginationDto } from "../../common/dto/pagination.dto";

export class PaymentHistoryDto extends PaginationDto {
  @IsOptional()
  @IsIn(["paid", "failed", "pending", "requires_review"])
  status?: "paid" | "failed" | "pending" | "requires_review";
}
