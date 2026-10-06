/** Giới hạn message (spec §1.1, §4.1). maxFilesPerMessage thuộc messages,
 * không phải storage config (spec §10.1). */
export const MAX_IMAGES_PER_MESSAGE = 5;
export const MAX_CONTENT_LENGTH = 2000;
export const PREVIEW_MAX_LENGTH = 100;

export const DEFAULT_HISTORY_LIMIT = 30;
export const MAX_HISTORY_LIMIT = 100;

export const IDEMPOTENCY_CONFLICT = "IDEMPOTENCY_CONFLICT";
