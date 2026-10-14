import { ApiProperty } from "@nestjs/swagger";

export enum PurchaseReviewStatus {
  NOT_REVIEWED = "NOT_REVIEWED",
  REVIEWED = "REVIEWED",
  EXPIRED = "EXPIRED",
}

export class PurchasedPostReviewDto {
  @ApiProperty({ enum: PurchaseReviewStatus })
  status!: PurchaseReviewStatus;

  @ApiProperty()
  canReview!: boolean;

  @ApiProperty({ format: "date-time" })
  reviewDeadline!: Date;

  @ApiProperty({ nullable: true })
  review!: unknown | null;
}
