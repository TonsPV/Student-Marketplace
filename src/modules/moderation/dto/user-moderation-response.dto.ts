import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  PostingRestrictionType,
  RestrictionStatus,
} from "../posting-restriction.rules";

export class UserRestrictionResponse {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ enum: PostingRestrictionType }) type!: PostingRestrictionType;
  @ApiProperty() reason!: string;
  @ApiProperty({ format: "date-time" }) startsAt!: string;
  @ApiProperty({ format: "date-time", nullable: true, type: String })
  expiresAt!: string | null;
  @ApiProperty({ enum: RestrictionStatus }) status!: RestrictionStatus;
  @ApiProperty({ format: "date-time" }) createdAt!: string;
  @ApiProperty({ format: "date-time", nullable: true, type: String })
  liftedAt!: string | null;
}

export class UserModerationStatusResponse {
  @ApiProperty()
  isRestricted!: boolean;
  @ApiProperty({ type: [UserRestrictionResponse] })
  activeRestrictions!: UserRestrictionResponse[];
  @ApiProperty({ type: [UserRestrictionResponse] })
  scheduledRestrictions!: UserRestrictionResponse[];
  @ApiProperty()
  canCreatePost!: boolean;
  @ApiProperty({
    description:
      "Automatic reputation warning and posting restriction based on current reviews.",
  })
  reputation!: {
    reviewCount: number;
    ratingAverage: number | null;
    warning: boolean;
    blocked: boolean;
    reason: string | null;
  };
}

export class UserRestrictionPageResponse {
  @ApiProperty({ type: [UserRestrictionResponse] })
  items!: UserRestrictionResponse[];
  @ApiProperty()
  meta!: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
