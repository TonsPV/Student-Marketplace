import type { MessageResponseDto } from "./message-response.dto";

export class PaginatedMessagesDto {
  /** sequence DESC (mới → cũ). */
  items!: MessageResponseDto[];
  /** ID item cuối, chỉ khi hasMore. */
  nextCursor!: string | null;
  hasMore!: boolean;
}
