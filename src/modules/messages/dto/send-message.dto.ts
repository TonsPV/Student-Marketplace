import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  MAX_CONTENT_LENGTH,
  MAX_HISTORY_LIMIT,
  MAX_IMAGES_PER_MESSAGE,
} from "../messages.constants";
import { IsExactlyOneTarget } from "./message-target.validator";

// ── E1: POST /messages ───────────────────────────────────────────────────────
// Đúng một postId/conversationId (IsUUID từng field + XOR class-level).
// content/images null bị reject; clientId bắt buộc ở E1.
@IsExactlyOneTarget()
export class SendMessageDto {
  @ApiPropertyOptional({ description: "Mở chat mới từ post ACTIVE" })
  @ValidateIf((o) => o.postId !== undefined)
  @IsUUID()
  postId?: string;

  @ApiPropertyOptional({ description: "Reply trong conversation có sẵn" })
  @ValidateIf((o) => o.conversationId !== undefined)
  @IsUUID()
  conversationId?: string;

  @ApiPropertyOptional({ maxLength: MAX_CONTENT_LENGTH })
  @ValidateIf((o) => o.content !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsString()
  @MaxLength(MAX_CONTENT_LENGTH)
  content?: string;

  @ApiPropertyOptional({ type: [String], maxItems: MAX_IMAGES_PER_MESSAGE })
  @ValidateIf((o) => o.images !== undefined)
  @IsArray()
  @ArrayMaxSize(MAX_IMAGES_PER_MESSAGE)
  @IsString({ each: true })
  images?: string[];

  @ApiProperty({ description: "Idempotency key theo sender, FE giữ khi retry" })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(64)
  clientId!: string;
}

// ── E5 alias: POST /conversations/:id/messages (deprecated) ──────────────────
// Chỉ content/images/clientId; path cung cấp conversationId sau ValidationPipe.
// Global forbidNonWhitelisted trả 400 nếu body gửi postId/conversationId.
export class SendConversationMessageDto {
  @ApiPropertyOptional({ maxLength: MAX_CONTENT_LENGTH })
  @ValidateIf((o) => o.content !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsString()
  @MaxLength(MAX_CONTENT_LENGTH)
  content?: string;

  @ApiPropertyOptional({ type: [String], maxItems: MAX_IMAGES_PER_MESSAGE })
  @ValidateIf((o) => o.images !== undefined)
  @IsArray()
  @ArrayMaxSize(MAX_IMAGES_PER_MESSAGE)
  @IsString({ each: true })
  images?: string[];

  @ApiPropertyOptional({
    description: "Optional ở alias; thiếu thì không có bảo đảm retry",
  })
  @ValidateIf((o) => o.clientId !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(64)
  clientId?: string;
}

// ── E3 query: limit 1–100 default 30, before = messageId ─────────────────────
export class GetMessagesQueryDto {
  @ApiPropertyOptional({ default: 30, minimum: 1, maximum: MAX_HISTORY_LIMIT })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_HISTORY_LIMIT)
  limit: number = 30;

  @ApiPropertyOptional({
    description: "Cursor messageId, resolve sang sequence",
  })
  @ValidateIf((o) => o.before !== undefined)
  @IsUUID()
  before?: string;
}

// ── E4 body: throughMessageId bắt buộc ───────────────────────────────────────
// FE gửi ID tin mới nhất ĐÃ RENDER sau load/nhận event; không dùng ID chưa
// render. Chỉ đánh dấu prefix đã xem (spec §4.1, §5.6).
export class MarkReadDto {
  @ApiProperty({ description: "ID tin mới nhất đã render" })
  @IsUUID()
  @IsNotEmpty()
  throughMessageId!: string;
}
