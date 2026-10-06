import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { isUUID } from "class-validator";
import { DataSource, EntityManager, In } from "typeorm";
import { uuidv7 } from "uuidv7";
import { PostEntity, PostStatus } from "../posts/post.entity";
import { UserEntity } from "../user/user.entity";
import { ConversationEntity } from "../conversations/entities/conversation.entity";
import { ConversationsService } from "../conversations/conversations.service";
import type { ConversationSnapshotDto } from "../conversations/dto/conversation-response.dto";
import { NotificationsService } from "../notifications/notifications.service";
import type { NotificationSnapshot } from "../notifications/dto/notification-response.dto";
import { RealtimeService } from "../realtime/realtime.service";
import { WS_EVENTS, type ChatReadPayload } from "../realtime/realtime.events";
import { StorageService } from "../storage/storage.service";
import { CONTENT_TYPE_TO_EXTENSION } from "../storage/storage.constants";
import { MessageEntity } from "./entities/message.entity";
import {
  IDEMPOTENCY_CONFLICT,
  MAX_CONTENT_LENGTH,
  MAX_IMAGES_PER_MESSAGE,
} from "./messages.constants";
import {
  buildMessagePreview,
  dedupKeys,
  isSameIdempotencyPayload,
  normalizeIdempotencyPayload,
  sortImagesByPosition,
  toMessageResponse,
  type IdempotencyPayload,
} from "./messages.mapper";
import type {
  SendConversationMessageDto,
  SendMessageDto,
} from "./dto/send-message.dto";
import type { GetMessagesQueryDto } from "./dto/send-message.dto";
import type { MarkReadDto } from "./dto/send-message.dto";
import type { MessageResponseDto } from "./dto/message-response.dto";
import type { PaginatedMessagesDto } from "./dto/paginated-messages.dto";

type NormalizedSend = {
  postId: string | undefined;
  conversationId: string | undefined;
  content: string | null;
  keys: string[];
  clientId: string | null;
};

type CommittedSendEvents = {
  dto: MessageResponseDto;
  conversationId: string;
  senderSnapshot: ConversationSnapshotDto;
  recipientSnapshot: ConversationSnapshotDto;
  senderNotiSnapshot: NotificationSnapshot;
  recipientNotiSnapshot: NotificationSnapshot;
};

type CommittedReadEvents = {
  conversationId: string;
  receipt: ChatReadPayload;
  senderSnapshot: ConversationSnapshotDto;
  recipientSnapshot: ConversationSnapshotDto;
  senderNotiSnapshot: NotificationSnapshot;
  recipientNotiSnapshot: NotificationSnapshot;
};

const PG_UNIQUE_VIOLATION = "23505";

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly conversationsService: ConversationsService,
    private readonly notificationsService: NotificationsService,
    private readonly storageService: StorageService,
    private readonly realtime: RealtimeService,
  ) {}

  // ── Public REST API ────────────────────────────────────────────────────────

  async sendMessage(
    senderId: string,
    dto: SendMessageDto,
  ): Promise<MessageResponseDto> {
    const input = this.normalizeSend(dto, true);
    return this.executeSend(senderId, input);
  }

  /** E5 alias deprecated: conversationId lấy từ path, clientId optional. */
  async sendConversationMessage(
    conversationId: string,
    senderId: string,
    dto: SendConversationMessageDto,
  ): Promise<MessageResponseDto> {
    if (!isUUID(conversationId)) {
      throw new BadRequestException("Invalid conversation id");
    }
    const input = this.normalizeSend({ ...dto, conversationId }, false);
    return this.executeSend(senderId, input);
  }

  async findMessages(
    conversationId: string,
    userId: string,
    query: GetMessagesQueryDto,
  ): Promise<PaginatedMessagesDto> {
    const limit = query.limit ?? 30;
    await this.conversationsService.assertParticipant(conversationId, userId);

    let beforeSequence: string | null = null;
    if (query.before !== undefined) {
      const rows = (await this.dataSource.query(
        `SELECT sequence FROM messages WHERE id = $1 AND conversation_id = $2`,
        [query.before, conversationId],
      )) as Array<{ sequence: string }>;
      if (rows.length === 0) {
        // Cursor không tồn tại hoặc thuộc conversation khác → 400,
        // không trả rỗng giả như đã hết lịch sử.
        throw new BadRequestException("Invalid pagination cursor");
      }
      beforeSequence = String(rows[0].sequence);
    }

    // Hai bước: page IDs trước (không join ảnh), rồi load ảnh cho page.
    const idRows = (await this.dataSource.query(
      `SELECT id, sequence FROM messages
        WHERE conversation_id = $1
          AND ($2::bigint IS NULL OR sequence < $2::bigint)
        ORDER BY sequence DESC
        LIMIT $3`,
      [conversationId, beforeSequence, limit + 1],
    )) as Array<{ id: string; sequence: string }>;

    if (idRows.length === 0) {
      return { items: [], nextCursor: null, hasMore: false };
    }
    const hasMore = idRows.length > limit;
    const pageIds = idRows.slice(0, limit).map((r) => r.id);

    const messages = await this.dataSource
      .getRepository(MessageEntity)
      .find({ where: { id: In(pageIds) }, relations: { images: true } });
    messages.sort((a, b) =>
      BigInt(a.sequence) < BigInt(b.sequence)
        ? 1
        : BigInt(a.sequence) > BigInt(b.sequence)
          ? -1
          : 0,
    );

    const items = await Promise.all(
      messages.map(async (message) => {
        const ordered = sortImagesByPosition(message.images ?? []);
        const prepared = await this.storageService.presignGetMany(
          ordered.map((img) => img.key),
        );
        return toMessageResponse(message, prepared);
      }),
    );
    return {
      items,
      nextCursor: hasMore ? items[items.length - 1].id : null,
      hasMore,
    };
  }

  async markAsRead(
    conversationId: string,
    userId: string,
    dto: MarkReadDto,
  ): Promise<{
    updated: number;
    unreadCount: number;
    readThroughSequence: string;
    stateVersion: string;
  }> {
    if (!dto || !isUUID(dto.throughMessageId)) {
      throw new BadRequestException("Invalid throughMessageId");
    }

    const committed = await this.dataSource.transaction(async (manager) => {
      const locked = await this.conversationsService.lockForParticipant(
        manager,
        conversationId,
        userId,
      );
      const target = (await manager.query(
        `SELECT id, sequence FROM messages
          WHERE id = $1 AND conversation_id = $2`,
        [dto.throughMessageId, conversationId],
      )) as Array<{ id: string; sequence: string }>;
      if (target.length === 0) {
        throw new BadRequestException(
          "Read target does not belong to this conversation",
        );
      }
      const isBuyer = locked.buyerId === userId;
      const currentWatermark = isBuyer
        ? locked.buyerReadSequence
        : locked.sellerReadSequence;
      const targetSequence = BigInt(String(target[0].sequence));
      const watermark = BigInt(String(currentWatermark));
      const readThrough =
        targetSequence > watermark ? targetSequence : watermark;
      const watermarkIncreased = readThrough > watermark;

      // Chỉ đánh dấu prefix đã xem, không đọc các tin đến sau cursor.
      const marked = (await manager.query(
        `WITH marked AS (UPDATE messages SET is_read = true
          WHERE conversation_id = $1 AND sender_id <> $2
            AND is_read = false AND sequence <= $3::bigint
          RETURNING id) SELECT id FROM marked`,
        [conversationId, userId, readThrough.toString()],
      )) as Array<{ id: string }>;

      // Phiên bản dùng cho notification reconcile: version mới dự kiến.
      // reconcile chỉ ghi khi state thực sự đổi (guard bên trong), nên
      // version dự kiến không bao giờ bị rò rỉ vào row khi no-op.
      const provisionalVersion = ConversationsService.nextVersion(
        String(locked.stateVersion),
      );
      const notiChanged =
        await this.notificationsService.reconcileAfterMessageRead(
          manager,
          userId,
          conversationId,
          provisionalVersion,
        );

      const changed =
        marked.length > 0 || watermarkIncreased || notiChanged.length > 0;
      const stateVersion = changed
        ? provisionalVersion
        : String(locked.stateVersion);
      if (changed) {
        await manager.query(
          `UPDATE conversations
              SET ${isBuyer ? "buyer_read_sequence" : "seller_read_sequence"} = $2,
                  state_version = $3
            WHERE id = $1`,
          [conversationId, readThrough.toString(), stateVersion],
        );
        if (notiChanged.length > 0) {
          await manager.query(
            `UPDATE notifications SET conversation_version = $3
              WHERE id = ANY($1::uuid[]) AND user_id = $2`,
            [notiChanged.map((n) => n.id), userId, stateVersion],
          );
        }
      }

      const countRows = (await manager.query(
        `SELECT COUNT(*)::int AS cnt FROM messages
          WHERE conversation_id = $1 AND sender_id <> $2 AND is_read = false`,
        [conversationId, userId],
      )) as Array<{ cnt: number }>;
      const conv = await manager
        .getRepository(ConversationEntity)
        .findOneBy({ id: conversationId });
      if (!conv) throw new NotFoundException("Conversation not found");
      const otherId = isBuyer ? locked.sellerId : locked.buyerId;
      const mine = await this.conversationsService.mapSnapshots(
        manager,
        [conv],
        userId,
      );
      const theirs = await this.conversationsService.mapSnapshots(
        manager,
        [conv],
        otherId,
      );
      const myNoti = await this.notificationsService.buildSnapshot(
        manager,
        userId,
        conversationId,
        stateVersion,
        notiChanged,
      );
      const theirNoti = await this.notificationsService.buildSnapshot(
        manager,
        otherId,
        conversationId,
        stateVersion,
        [],
      );
      return {
        result: {
          updated: marked.length,
          unreadCount: Number(countRows[0]?.cnt ?? 0),
          readThroughSequence: readThrough.toString(),
          stateVersion,
        },
        changed,
        receipt: {
          conversationId,
          readerId: userId,
          readThroughSequence: readThrough.toString(),
          stateVersion,
          readAt: new Date().toISOString(),
        } as ChatReadPayload,
        mine: mine[0],
        theirs: theirs[0],
        myNoti,
        theirNoti,
        otherId,
      };
    });

    if (committed.changed) {
      const events: CommittedReadEvents = {
        conversationId,
        receipt: committed.receipt,
        senderSnapshot: committed.mine,
        recipientSnapshot: committed.theirs,
        senderNotiSnapshot: committed.myNoti,
        recipientNotiSnapshot: committed.theirNoti,
      };
      // userId là reader; otherId là người còn lại — snapshot mỗi bên
      // đã materialize đúng; ở đây chỉ phát theo vai reader/other.
      this.dispatchReadEvents(userId, committed.otherId, events);
    }
    return committed.result;
  }

  async getUnreadCount(
    userId: string,
  ): Promise<{ total: number; conversations: number }> {
    return this.conversationsService.getUnreadCount(userId);
  }

  // ── Normalize + preflight (ngoài transaction) ──────────────────────────────

  private normalizeSend(
    dto: {
      postId?: string;
      conversationId?: string;
      content?: string;
      images?: string[];
      clientId?: string | null;
    },
    requireClientId: boolean,
  ): NormalizedSend {
    // Service vẫn kiểm tra XOR/limits/types, không tin mọi caller qua pipe.
    const hasPost = dto.postId !== undefined;
    const hasConv = dto.conversationId !== undefined;
    if (hasPost === hasConv) {
      throw new BadRequestException(
        "Exactly one of postId or conversationId must be provided",
      );
    }
    if (hasPost && !isUUID(dto.postId as string)) {
      throw new BadRequestException("Invalid postId");
    }
    if (hasConv && !isUUID(dto.conversationId as string)) {
      throw new BadRequestException("Invalid conversationId");
    }

    let content: string | null = null;
    if (dto.content !== undefined) {
      if (typeof dto.content !== "string") {
        throw new BadRequestException("Invalid content");
      }
      const trimmed = dto.content.trim();
      if (trimmed.length > MAX_CONTENT_LENGTH) {
        throw new BadRequestException(
          `Content must not exceed ${MAX_CONTENT_LENGTH} characters`,
        );
      }
      content = trimmed.length > 0 ? trimmed : null;
    }

    let keys: string[] = [];
    if (dto.images !== undefined) {
      if (!Array.isArray(dto.images)) {
        throw new BadRequestException("Invalid images");
      }
      if (dto.images.length > MAX_IMAGES_PER_MESSAGE) {
        throw new BadRequestException(
          `At most ${MAX_IMAGES_PER_MESSAGE} images per message`,
        );
      }
      keys = dedupKeys(dto.images);
    }

    let clientId: string | null = null;
    if (dto.clientId !== undefined && dto.clientId !== null) {
      if (typeof dto.clientId !== "string") {
        throw new BadRequestException("Invalid clientId");
      }
      const trimmed = dto.clientId.trim();
      if (trimmed.length < 1 || trimmed.length > 64) {
        throw new BadRequestException(
          "clientId must be between 1 and 64 characters",
        );
      }
      clientId = trimmed;
    } else if (dto.clientId === null) {
      throw new BadRequestException("Invalid clientId");
    }
    if (requireClientId && !clientId) {
      throw new BadRequestException("clientId is required");
    }

    if (!content && keys.length === 0) {
      throw new BadRequestException(
        "Message must contain text or at least one image",
      );
    }
    return {
      postId: dto.postId,
      conversationId: dto.conversationId,
      content,
      keys,
      clientId,
    };
  }

  /**
   * Preflight ngoài transaction: authorize target, kiểm tra prefix owner,
   * HEAD song song (tối đa 5) + ký GET. Không làm R2 network trong lúc giữ
   * khóa conversation. Lỗi preflight mutable (post SOLD/key tạm thiếu) được
   * giữ lại để kiểm tra idempotency dưới advisory lock trước khi kết luận.
   */
  private async preflight(
    senderId: string,
    input: NormalizedSend,
  ): Promise<{
    sellerId: string | null;
    prepared: { urls: string[]; expiresAt: string | null };
    error: Error | null;
  }> {
    try {
      let sellerId: string | null = null;
      if (input.conversationId) {
        await this.conversationsService.assertParticipant(
          input.conversationId,
          senderId,
        );
      }
      if (input.postId) {
        const post = await this.dataSource
          .getRepository(PostEntity)
          .findOneBy({ id: input.postId });
        if (!post || post.status !== PostStatus.ACTIVE) {
          throw new NotFoundException("Post not found or not available");
        }
        if (post.sellerId === senderId) {
          throw new BadRequestException(
            "You cannot start a conversation about your own post",
          );
        }
        sellerId = post.sellerId;
      }
      for (const key of input.keys) {
        if (!StorageService.isMessageImageKeyOwnedBy(key, senderId)) {
          throw new BadRequestException(
            "Image key is invalid or does not belong to the sender",
          );
        }
      }
      const heads = await Promise.all(
        input.keys.map((key) => this.storageService.headObject(key)),
      );
      for (let i = 0; i < input.keys.length; i++) {
        const head = heads[i];
        if (!head) {
          throw new BadRequestException(
            "Image has not been uploaded or is inaccessible",
          );
        }
        const keyExt = input.keys[i].split(".").pop()?.toLowerCase();
        const expectedType = Object.entries(CONTENT_TYPE_TO_EXTENSION).find(
          ([, ext]) => ext === keyExt,
        )?.[0];
        if (
          !head.contentType ||
          head.contentType !== expectedType ||
          head.contentLength < 1 ||
          head.contentLength > this.storageService.maxFileSizeBytes
        ) {
          throw new BadRequestException(
            "Uploaded image metadata does not match the request",
          );
        }
      }
      const prepared = await this.storageService.presignGetMany(input.keys);
      return { sellerId, prepared, error: null };
    } catch (err) {
      if (!input.clientId) throw err;
      return {
        sellerId: null,
        prepared: { urls: [], expiresAt: null },
        error: err as Error,
      };
    }
  }

  // ── Send transaction ───────────────────────────────────────────────────────

  private async executeSend(
    senderId: string,
    input: NormalizedSend,
  ): Promise<MessageResponseDto> {
    const preflight = await this.preflight(senderId, input);

    const committed = await this.dataSource.transaction(async (manager) => {
      // 1. Advisory lock theo (sender, clientId) + authoritative replay check.
      // Fast path ngoài transaction chỉ là optimization; check dưới lock này
      // mới có tính quyết định (spec §5.3–5.4).
      if (input.clientId) {
        await manager.query(
          `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
          [senderId, input.clientId],
        );
        const replay = await this.findReplay(manager, senderId, input);
        if (replay) return { replay: true as const, dto: replay, events: null };
      }

      // 2. Không replay: lỗi preflight giữ lại tới đây mới throw.
      if (preflight.error) throw preflight.error;

      // 3. Recheck nhánh target + khóa conversation (mọi query dùng manager).
      let conversationId: string;
      let lockedConv: ConversationEntity;
      if (input.postId) {
        const postRows = (await manager.query(
          `SELECT id, seller_id, status FROM posts
            WHERE id = $1 AND deleted_at IS NULL FOR SHARE`,
          [input.postId],
        )) as Array<{ id: string; seller_id: string; status: PostStatus }>;
        const post = postRows[0];
        if (!post || post.status !== PostStatus.ACTIVE) {
          throw new NotFoundException("Post not found or not available");
        }
        if (post.seller_id === senderId) {
          throw new BadRequestException(
            "You cannot start a conversation about your own post",
          );
        }
        const created =
          await this.conversationsService.findOrCreateConversation(
            input.postId,
            senderId,
            post.seller_id,
            manager,
          );
        const locked = await this.conversationsService.lockForParticipant(
          manager,
          created.id,
          senderId,
        );
        conversationId = locked.id;
        lockedConv = locked;
      } else {
        const locked = await this.conversationsService.lockForParticipant(
          manager,
          input.conversationId as string,
          senderId,
        );
        conversationId = locked.id;
        lockedConv = locked;
      }

      // 4. Cấp sequence + INSERT message/images. createdAt lấy ở DB sau khi
      // đã khóa conversation (GREATEST với last_message_at, null fallback).
      const sequence = (
        BigInt(String(lockedConv.lastMessageSequence)) + 1n
      ).toString();
      const messageId = uuidv7();
      let createdAt: Date;
      try {
        const inserted = (await manager.query(
          `INSERT INTO messages
             (id, conversation_id, sender_id, sequence, content, client_id,
              is_read, created_at)
           VALUES ($1, $2, $3, $4::bigint, $5, $6, false,
             GREATEST(clock_timestamp(),
               COALESCE((SELECT last_message_at FROM conversations WHERE id = $2),
                        clock_timestamp())))
           RETURNING id, created_at`,
          [
            messageId,
            conversationId,
            senderId,
            sequence,
            input.content,
            input.clientId,
          ],
        )) as Array<{ id: string; created_at: Date }>;
        createdAt = new Date(inserted[0].created_at);
        for (let position = 0; position < input.keys.length; position++) {
          await manager.query(
            `INSERT INTO message_images (id, message_id, key, position)
             VALUES ($1, $2, $3, $4)`,
            [uuidv7(), messageId, input.keys[position], position],
          );
        }
      } catch (err) {
        // Image key đã gắn vào message khác, hoặc race clientId → 409 và
        // rollback; không query tiếp trong transaction aborted.
        const driverError = this.toDriverError(err);
        if (
          driverError?.code === PG_UNIQUE_VIOLATION &&
          (driverError.constraint === "uq_message_images_key" ||
            driverError.constraint === "uq_messages_sender_client" ||
            driverError.constraint === "uq_messages_conversation_sequence")
        ) {
          throw new ConflictException(
            driverError.constraint === "uq_message_images_key"
              ? "Image key is already attached to another message"
              : IDEMPOTENCY_CONFLICT,
          );
        }
        throw err;
      }

      // 5. UPDATE metadata/version từ saved message (không dùng conv cũ).
      const preview = buildMessagePreview(input.content, input.keys.length);
      const stateVersion = ConversationsService.nextVersion(
        String(lockedConv.stateVersion),
      );
      await manager.query(
        `UPDATE conversations
            SET last_message_id = $2, last_message = $3, last_message_at = $4,
                last_message_sender_id = $5, last_message_sequence = $6::bigint,
                state_version = $7::bigint
          WHERE id = $1`,
        [
          conversationId,
          messageId,
          preview,
          createdAt.toISOString(),
          senderId,
          sequence,
          stateVersion,
        ],
      );

      // 6. Upsert NEW_MESSAGE cho recipient + materialize snapshots/DTO.
      const recipientId =
        lockedConv.buyerId === senderId
          ? lockedConv.sellerId
          : lockedConv.buyerId;
      const sender = await manager
        .getRepository(UserEntity)
        .findOne({ select: ["id", "fullName"], where: { id: senderId } });
      const senderName = sender?.fullName ?? "Ai đó";
      const title = `${senderName} đã nhắn tin cho bạn`.slice(0, 200);
      const recipientNoti = await this.notificationsService.upsertNewMessage(
        manager,
        {
          userId: recipientId,
          conversationId,
          title,
          body: preview,
          lastMessageSequence: sequence,
          conversationVersion: stateVersion,
        },
      );

      const reloaded = await manager
        .getRepository(ConversationEntity)
        .findOneBy({ id: conversationId });
      if (!reloaded) throw new NotFoundException("Conversation not found");
      const senderSnapshot = await this.conversationsService.mapSnapshots(
        manager,
        [reloaded],
        senderId,
      );
      const recipientSnapshot = await this.conversationsService.mapSnapshots(
        manager,
        [reloaded],
        recipientId,
      );
      const senderNotiSnapshot = await this.notificationsService.buildSnapshot(
        manager,
        senderId,
        conversationId,
        stateVersion,
        [],
      );
      const recipientNotiSnapshot =
        await this.notificationsService.buildSnapshot(
          manager,
          recipientId,
          conversationId,
          stateVersion,
          [NotificationsService.toResponse(recipientNoti)],
        );

      const core = {
        id: messageId,
        conversationId,
        senderId,
        sequence,
        content: input.content,
        isRead: false,
        createdAt,
        clientId: input.clientId,
      } as MessageEntity;
      const dto = toMessageResponse(core, preflight.prepared);
      const events: CommittedSendEvents = {
        dto,
        conversationId,
        senderSnapshot: senderSnapshot[0],
        recipientSnapshot: recipientSnapshot[0],
        senderNotiSnapshot,
        recipientNotiSnapshot,
      };
      return { replay: false as const, dto, events };
    });

    // Sau commit: replay không phát lại event; send mới dispatch best-effort.
    if (!committed.replay && committed.events) {
      this.dispatchSendEvents(senderId, committed.events);
    }
    return committed.dto;
  }

  /** Replay check dưới advisory lock: cùng key/payload → message cũ + URL mới. */
  private async findReplay(
    manager: EntityManager,
    senderId: string,
    input: NormalizedSend,
  ): Promise<MessageResponseDto | null> {
    const rows = (await manager.query(
      `SELECT id, conversation_id, sender_id, sequence, content, client_id,
              is_read, created_at
         FROM messages WHERE sender_id = $1 AND client_id = $2`,
      [senderId, input.clientId],
    )) as Array<{
      id: string;
      conversation_id: string;
      sender_id: string;
      sequence: string;
      content: string | null;
      client_id: string | null;
      is_read: boolean;
      created_at: Date;
    }>;
    const existing = rows[0];
    if (!existing) return null;

    // Authorize + resolve logical target (postId/conversationId cùng
    // conversation là cùng target — không so sánh hình thức field).
    await this.conversationsService.assertParticipant(
      existing.conversation_id,
      senderId,
      manager,
    );
    let targetConversationId: string;
    if (input.postId) {
      const conv = await manager
        .getRepository(ConversationEntity)
        .findOneBy({ postId: input.postId, buyerId: senderId });
      if (!conv || conv.id !== existing.conversation_id) {
        throw new ConflictException(IDEMPOTENCY_CONFLICT);
      }
      targetConversationId = conv.id;
    } else {
      targetConversationId = input.conversationId as string;
      if (targetConversationId !== existing.conversation_id) {
        throw new ConflictException(IDEMPOTENCY_CONFLICT);
      }
    }

    const keyRows = (await manager.query(
      `SELECT key FROM message_images WHERE message_id = $1 ORDER BY position`,
      [existing.id],
    )) as Array<{ key: string }>;
    const stored: IdempotencyPayload = {
      conversationId: existing.conversation_id,
      content: existing.content,
      keys: keyRows.map((r) => r.key),
    };
    const requested = normalizeIdempotencyPayload(
      targetConversationId,
      input.content,
      input.keys,
    );
    if (!isSameIdempotencyPayload(stored, requested)) {
      throw new ConflictException(IDEMPOTENCY_CONFLICT);
    }

    const prepared = await this.storageService.presignGetMany(stored.keys);
    const core = {
      id: existing.id,
      conversationId: existing.conversation_id,
      senderId: existing.sender_id,
      sequence: String(existing.sequence),
      content: existing.content,
      isRead: existing.is_read,
      createdAt: new Date(existing.created_at),
      clientId: existing.client_id,
    } as MessageEntity;
    return toMessageResponse(core, prepared);
  }

  // ── Dispatch sau commit (best effort, lỗi emit chỉ log) ────────────────────

  private dispatchSendEvents(
    senderId: string,
    events: CommittedSendEvents,
  ): void {
    try {
      this.realtime.emitToConversation(
        events.conversationId,
        WS_EVENTS.CHAT_MESSAGE_NEW,
        events.dto,
      );
    } catch (err) {
      this.logEmitError(WS_EVENTS.CHAT_MESSAGE_NEW, err);
    }
    this.emitConversationAndNoti(
      events.senderSnapshot,
      events.senderNotiSnapshot,
      senderId,
    );
    this.emitConversationAndNoti(
      events.recipientSnapshot,
      events.recipientNotiSnapshot,
      this.counterpartOf(
        senderId,
        events.senderSnapshot,
        events.recipientSnapshot,
      ),
    );
  }

  private dispatchReadEvents(
    readerId: string,
    otherId: string,
    events: CommittedReadEvents,
  ): void {
    try {
      this.realtime.emitToConversation(
        events.conversationId,
        WS_EVENTS.CHAT_READ,
        events.receipt,
      );
    } catch (err) {
      this.logEmitError(WS_EVENTS.CHAT_READ, err);
    }
    this.emitConversationAndNoti(
      events.senderSnapshot,
      events.senderNotiSnapshot,
      readerId,
    );
    this.emitConversationAndNoti(
      events.recipientSnapshot,
      events.recipientNotiSnapshot,
      otherId,
    );
  }

  private emitConversationAndNoti(
    convSnapshot: ConversationSnapshotDto,
    notiSnapshot: NotificationSnapshot,
    userId: string,
  ): void {
    try {
      this.realtime.emitToUser(
        userId,
        WS_EVENTS.CHAT_CONVERSATION_UPDATED,
        this.conversationsService.toUpdatedPayload(convSnapshot),
      );
    } catch (err) {
      this.logEmitError(WS_EVENTS.CHAT_CONVERSATION_UPDATED, err);
    }
    try {
      this.realtime.emitToUser(
        userId,
        WS_EVENTS.NOTIFICATION_CHANGED,
        notiSnapshot,
      );
    } catch (err) {
      this.logEmitError(WS_EVENTS.NOTIFICATION_CHANGED, err);
    }
  }

  private counterpartOf(
    senderId: string,
    senderSnapshot: ConversationSnapshotDto,
    recipientSnapshot: ConversationSnapshotDto,
  ): string {
    if (senderSnapshot.counterpart.id !== senderId) {
      return senderSnapshot.counterpart.id;
    }
    return recipientSnapshot.counterpart.id;
  }
  private logEmitError(event: string, err: unknown): void {
    this.logger.error(
      `emit ${event} failed: ${err instanceof Error ? err.message : err}`,
    );
  }

  private toDriverError(
    err: unknown,
  ): { code?: string; constraint?: string } | undefined {
    if (err && typeof err === "object" && "driverError" in err) {
      return (err as { driverError: { code?: string; constraint?: string } })
        .driverError;
    }
    if (err && typeof err === "object" && "code" in err) {
      return err as { code?: string; constraint?: string };
    }
    return undefined;
  }
}
