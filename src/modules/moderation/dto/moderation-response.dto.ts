import { ApiProperty } from "@nestjs/swagger";
import {
  PostingRestrictionType,
  RestrictionStatus,
} from "../posting-restriction.rules";

/** D5: only id and fullName; never email or credentials. */
export class ModerationUserSummary {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() fullName!: string;
}

export class WarningResponse {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) userId!: string;
  @ApiProperty({ type: ModerationUserSummary }) user!: ModerationUserSummary;
  @ApiProperty() reason!: string;
  @ApiProperty({ format: "uuid", nullable: true, type: String })
  sourceReportId!: string | null;
  @ApiProperty({ type: ModerationUserSummary })
  issuedBy!: ModerationUserSummary;
  @ApiProperty({ format: "date-time" }) createdAt!: string;
}

export class RestrictionResponse {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) userId!: string;
  @ApiProperty({ type: ModerationUserSummary }) user!: ModerationUserSummary;
  @ApiProperty({ enum: PostingRestrictionType }) type!: PostingRestrictionType;
  @ApiProperty() reason!: string;
  @ApiProperty({ format: "date-time" }) startsAt!: string;
  @ApiProperty({ format: "date-time", nullable: true, type: String })
  expiresAt!: string | null;
  @ApiProperty({ enum: RestrictionStatus }) status!: RestrictionStatus;
  @ApiProperty({ type: ModerationUserSummary })
  issuedBy!: ModerationUserSummary;
  @ApiProperty({ format: "uuid", nullable: true, type: String })
  sourceReportId!: string | null;
  @ApiProperty({ format: "date-time" }) createdAt!: string;
  @ApiProperty({ format: "date-time", nullable: true, type: String })
  liftedAt!: string | null;
  @ApiProperty({ type: ModerationUserSummary, nullable: true })
  liftedBy!: ModerationUserSummary | null;
  @ApiProperty({ nullable: true, type: String }) liftReason!: string | null;
}

export interface Paginated<T> {
  items: T[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}
