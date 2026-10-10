import {
  BadRequestException,
  InternalServerErrorException,
} from "@nestjs/common";
import { isUUID as isUuid } from "class-validator";

export interface PostProjection {
  id: string;
  sellerId: string;
  status: string;
  deletedAt: Date | null;
}

export interface CategoryProjection {
  id: string;
}

export interface UserProjection {
  id: string;
  deletedAt: Date | null;
  isLocked: boolean;
}

export interface ReportProjection {
  id: string;
  reporterId: string;
  targetType: string;
  targetId: string;
  status: string;
}

export interface ReviewProjection {
  id: string;
  reviewerId: string;
  postId: string;
}

export interface FavoriteProjection {
  id: string;
  userId: string;
  postId: string;
}

export interface ConversationProjection {
  id: string;
  buyerId: string;
  sellerId: string;
  postId: string;
}

export interface NotificationProjection {
  id: string;
  userId: string;
}

function assertUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !isUuid(value)) {
    throw new InternalServerErrorException(
      `Invalid subject projection: ${field}`,
    );
  }
  return value.toLowerCase();
}

function assertDeletedAt(value: unknown, field = "deletedAt"): Date | null {
  if (value === null) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  throw new InternalServerErrorException(
    `Invalid subject projection: ${field} must be Date | null`,
  );
}

export function toPostProjection(raw: {
  id: unknown;
  sellerId?: unknown;
  seller_id?: unknown;
  status: unknown;
  deletedAt?: unknown;
  deleted_at?: unknown;
}): PostProjection {
  const id = assertUuid(raw.id, "Post.id");
  const sellerRaw = raw.sellerId ?? raw.seller_id;
  const sellerId = assertUuid(sellerRaw, "Post.sellerId");
  if (
    typeof raw.status !== "string" ||
    !["active", "sold", "hidden"].includes(raw.status)
  ) {
    throw new InternalServerErrorException(
      "Invalid subject projection: Post.status",
    );
  }
  const deletedRaw =
    raw.deletedAt !== undefined ? raw.deletedAt : raw.deleted_at;
  if (deletedRaw === undefined) {
    throw new InternalServerErrorException(
      "Invalid subject projection: Post.deletedAt is missing",
    );
  }
  return {
    id,
    sellerId,
    status: raw.status as string,
    deletedAt: assertDeletedAt(deletedRaw),
  };
}

export function toConversationProjection(raw: {
  id: unknown;
  buyerId?: unknown;
  buyer_id?: unknown;
  sellerId?: unknown;
  seller_id?: unknown;
  postId?: unknown;
  post_id?: unknown;
}): ConversationProjection {
  const id = assertUuid(raw.id, "Conversation.id");
  const buyerId = assertUuid(
    raw.buyerId ?? raw.buyer_id,
    "Conversation.buyerId",
  );
  const sellerId = assertUuid(
    raw.sellerId ?? raw.seller_id,
    "Conversation.sellerId",
  );
  const postId = assertUuid(raw.postId ?? raw.post_id, "Conversation.postId");
  if (buyerId === sellerId) {
    throw new InternalServerErrorException(
      "Invalid subject projection: Conversation buyerId === sellerId",
    );
  }
  return { id, buyerId, sellerId, postId };
}

export function toUserProjection(raw: {
  id: unknown;
  deletedAt?: unknown;
  deleted_at?: unknown;
  isLocked: unknown;
}): UserProjection {
  const id = assertUuid(raw.id, "User.id");
  const deletedRaw =
    raw.deletedAt !== undefined ? raw.deletedAt : raw.deleted_at;
  if (deletedRaw === undefined) {
    throw new InternalServerErrorException(
      "Invalid subject projection: User.deletedAt is missing",
    );
  }
  if (typeof raw.isLocked !== "boolean") {
    throw new InternalServerErrorException(
      "Invalid subject projection: User.isLocked",
    );
  }
  return { id, deletedAt: assertDeletedAt(deletedRaw), isLocked: raw.isLocked };
}

export function toReportProjection(raw: {
  id: unknown;
  reporterId?: unknown;
  reporter_id?: unknown;
  targetType?: unknown;
  target_type?: unknown;
  targetId?: unknown;
  target_id?: unknown;
  status: unknown;
}): ReportProjection {
  const id = assertUuid(raw.id, "Report.id");
  const reporterId = assertUuid(
    raw.reporterId ?? raw.reporter_id,
    "Report.reporterId",
  );
  const targetTypeRaw = raw.targetType ?? raw.target_type;
  const targetId = assertUuid(raw.targetId ?? raw.target_id, "Report.targetId");
  if (targetTypeRaw !== "POST" && targetTypeRaw !== "USER") {
    throw new InternalServerErrorException(
      "Invalid subject projection: Report.targetType",
    );
  }
  if (
    typeof raw.status !== "string" ||
    !["PENDING", "RESOLVED", "DISMISSED"].includes(raw.status)
  ) {
    throw new InternalServerErrorException(
      "Invalid subject projection: Report.status",
    );
  }
  return {
    id,
    reporterId,
    targetType: targetTypeRaw,
    targetId,
    status: raw.status as string,
  };
}

export function toReviewProjection(raw: {
  id: unknown;
  reviewerId?: unknown;
  reviewer_id?: unknown;
  postId?: unknown;
  post_id?: unknown;
}): ReviewProjection {
  return {
    id: assertUuid(raw.id, "Review.id"),
    reviewerId: assertUuid(
      raw.reviewerId ?? raw.reviewer_id,
      "Review.reviewerId",
    ),
    postId: assertUuid(raw.postId ?? raw.post_id, "Review.postId"),
  };
}

export function toFavoriteProjection(raw: {
  id: unknown;
  userId?: unknown;
  user_id?: unknown;
  postId?: unknown;
  post_id?: unknown;
}): FavoriteProjection {
  return {
    id: assertUuid(raw.id, "Favorite.id"),
    userId: assertUuid(raw.userId ?? raw.user_id, "Favorite.userId"),
    postId: assertUuid(raw.postId ?? raw.post_id, "Favorite.postId"),
  };
}

export function toNotificationProjection(raw: {
  id: unknown;
  userId?: unknown;
  user_id?: unknown;
}): NotificationProjection {
  return {
    id: assertUuid(raw.id, "Notification.id"),
    userId: assertUuid(raw.userId ?? raw.user_id, "Notification.userId"),
  };
}

export function assertNoPrototypePollution(
  patch: Record<string, unknown>,
): void {
  const proto = Object.getPrototypeOf(patch);
  if (proto !== Object.prototype && proto !== null) {
    throw new BadRequestException("Invalid patch prototype");
  }
  for (const key of Object.getOwnPropertyNames(patch)) {
    if (key === "__proto__" || key === "prototype" || key === "constructor") {
      throw new BadRequestException("Invalid field: " + key);
    }
    if (key.includes(".")) {
      throw new BadRequestException("Invalid field: " + key);
    }
  }
}

export function normalizeResourceProjection(
  name: string,
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const id = raw.id;
  switch (name) {
    case "Post":
      return {
        ...toPostProjection({
          id,
          sellerId: raw.sellerId,
          seller_id: raw.seller_id,
          status: raw.status,
          deletedAt: raw.deletedAt,
          deleted_at: raw.deleted_at,
        }),
      };
    case "User":
      return {
        ...toUserProjection({
          id,
          deletedAt: raw.deletedAt,
          deleted_at: raw.deleted_at,
          isLocked: raw.isLocked,
        }),
      };
    case "Conversation":
      return {
        ...toConversationProjection({
          id,
          buyerId: raw.buyerId,
          buyer_id: raw.buyer_id,
          sellerId: raw.sellerId,
          seller_id: raw.seller_id,
          postId: raw.postId,
          post_id: raw.post_id,
        }),
      };
    case "Report":
      return {
        ...toReportProjection({
          id,
          reporterId: raw.reporterId,
          reporter_id: raw.reporter_id,
          targetType: raw.targetType,
          target_type: raw.target_type,
          targetId: raw.targetId,
          target_id: raw.target_id,
          status: raw.status,
        }),
      };
    case "Review":
      return {
        ...toReviewProjection({
          id,
          reviewerId: raw.reviewerId,
          reviewer_id: raw.reviewer_id,
          postId: raw.postId,
          post_id: raw.post_id,
        }),
      };
    case "Favorite":
      return {
        ...toFavoriteProjection({
          id,
          userId: raw.userId,
          user_id: raw.user_id,
          postId: raw.postId,
          post_id: raw.post_id,
        }),
      };
    case "Notification":
      return {
        ...toNotificationProjection({
          id,
          userId: raw.userId,
          user_id: raw.user_id,
        }),
      };
    case "Category":
      return { id: assertUuid(id, "Category.id") };
    default:
      throw new InternalServerErrorException("Unknown resource subject");
  }
}
export function normalizeCreateCandidate(
  name: string,
  raw: Record<string, unknown>,
): Record<string, unknown> {
  switch (name) {
    case "Post":
      return { sellerId: assertUuid(raw.sellerId, "Post.sellerId") };
    case "Category":
      return {};
    case "Report":
      if (raw.targetType !== "POST" && raw.targetType !== "USER")
        throw new InternalServerErrorException("Invalid report target");
      return {
        reporterId: assertUuid(raw.reporterId, "Report.reporterId"),
        targetId: assertUuid(raw.targetId, "Report.targetId"),
        targetType: raw.targetType,
      };
    case "Review":
      return {
        reviewerId: assertUuid(raw.reviewerId, "Review.reviewerId"),
        postId: assertUuid(raw.postId, "Review.postId"),
      };
    case "Favorite":
      return {
        userId: assertUuid(raw.userId, "Favorite.userId"),
        postId: assertUuid(raw.postId, "Favorite.postId"),
      };
    case "Conversation": {
      const buyerId = assertUuid(raw.buyerId, "Conversation.buyerId");
      const sellerId = assertUuid(raw.sellerId, "Conversation.sellerId");
      if (buyerId === sellerId)
        throw new InternalServerErrorException(
          "Invalid conversation participants",
        );
      return {
        buyerId,
        sellerId,
        postId: assertUuid(raw.postId, "Conversation.postId"),
      };
    }
    case "Upload":
      if (raw.purpose !== "message" && raw.purpose !== "post")
        throw new BadRequestException("Unsupported upload purpose");
      return {
        ownerId: assertUuid(raw.ownerId, "Upload.ownerId"),
        purpose: raw.purpose,
      };
    default:
      throw new InternalServerErrorException("Unknown create subject");
  }
}
