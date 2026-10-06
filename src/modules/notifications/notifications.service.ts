import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, EntityManager, In, Repository } from "typeorm";
import { uuidv7 } from "uuidv7";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { createPaginationMeta } from "../../common/utils/pagination.util";
import { ConversationsService } from "../conversations/conversations.service";
import { ConversationEntity } from "../conversations/entities/conversation.entity";
import { buildMessagePreview } from "../messages/messages.mapper";
import { RealtimeService } from "../realtime/realtime.service";
import { WS_EVENTS } from "../realtime/realtime.events";
import { NotificationEntity, NotificationType } from "./notification.entity";
import {
  NotificationResponseDto,
  NotificationSnapshot,
} from "./dto/notification-response.dto";

export type UpsertNewMessageInput = {
  userId: string;
  conversationId: string;
  title: string;
  body: string | null;
  lastMessageSequence: string;
  conversationVersion: string;
};

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(NotificationEntity)
    private readonly notificationsRepository: Repository<NotificationEntity>,
    private readonly dataSource: DataSource,
    private readonly conversationsService: ConversationsService,
    private readonly realtime: RealtimeService,
  ) {}

  // ── Pure mapper ────────────────────────────────────────────────────────────

  static toResponse(entity: NotificationEntity): NotificationResponseDto {
    return {
      id: entity.id,
      type: entity.type,
      refId: entity.refId,
      title: entity.title,
      body: entity.body,
      isRead: entity.isRead,
      lastMessageSequence:
        entity.lastMessageSequence === null ||
        entity.lastMessageSequence === undefined
          ? null
          : String(entity.lastMessageSequence),
      conversationVersion:
        entity.conversationVersion === null ||
        entity.conversationVersion === undefined
          ? null
          : String(entity.conversationVersion),
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }

  // ── Atomic upsert (chỉ gọi khi có message MỚI, đã giữ conversation lock) ───

  /**
   * Bắt buộc chạy với EntityManager trong transaction của caller và caller
   * đã giữ row lock conversation. Không gọi từ emit dispatcher/replay
   * (spec §6.1). createdAt giữ nguyên khi gộp (sort bằng updatedAt,id).
   */
  async upsertNewMessage(
    manager: EntityManager,
    input: UpsertNewMessageInput,
  ): Promise<NotificationEntity> {
    const title = input.title.slice(0, 200);
    const rows = (await manager.query(
      `INSERT INTO notifications
         (id, user_id, type, ref_id, title, body, is_read,
          last_message_sequence, conversation_version,
          created_at, updated_at)
       VALUES ($1, $2, 'new_message', $3, $4, $5, false, $6, $7,
               clock_timestamp(), clock_timestamp())
       ON CONFLICT (user_id, type, ref_id)
         WHERE type = 'new_message' AND is_read = false AND ref_id IS NOT NULL
       DO UPDATE SET title = EXCLUDED.title,
                     body = EXCLUDED.body,
                     last_message_sequence = EXCLUDED.last_message_sequence,
                     conversation_version = EXCLUDED.conversation_version,
                     updated_at = clock_timestamp()
       RETURNING *`,
      [
        uuidv7(),
        input.userId,
        input.conversationId,
        title,
        input.body,
        input.lastMessageSequence,
        input.conversationVersion,
      ],
    )) as NotificationEntity[];
    return this.mapRawRow(rows[0]);
  }

  // ── Read-path helpers (manager của caller) ─────────────────────────────────

  async findUnread(
    manager: EntityManager,
    userId: string,
    conversationId: string,
  ): Promise<NotificationEntity | null> {
    const rows = (await manager.query(
      `SELECT * FROM notifications
        WHERE user_id = $1 AND type = 'new_message'
          AND ref_id = $2 AND is_read = false
        LIMIT 1`,
      [userId, conversationId],
    )) as NotificationEntity[];
    return rows[0] ? this.mapRawRow(rows[0]) : null;
  }

  async buildSnapshot(
    manager: EntityManager,
    userId: string,
    conversationId: string,
    stateVersion: string,
    changed: NotificationResponseDto[],
  ): Promise<NotificationSnapshot> {
    const unread = await this.findUnread(manager, userId, conversationId);
    return {
      conversationId,
      stateVersion: String(stateVersion),
      unreadNotification: unread
        ? NotificationsService.toResponse(unread)
        : null,
      changed,
    };
  }

  /**
   * Dùng sau mark message-read trong cùng transaction: nếu còn incoming
   * chưa đọc → giữ unread, body/lastMessageSequence theo tin mới nhất chưa
   * đọc; nếu hết → mark notification read. Không tạo lại notification khi
   * user đã đọc thủ công (N3/N4); persist cùng message read (spec §5.6.4).
   */
  async reconcileAfterMessageRead(
    manager: EntityManager,
    userId: string,
    conversationId: string,
    conversationVersion: string,
  ): Promise<NotificationResponseDto[]> {
    const unread = await this.findUnread(manager, userId, conversationId);
    if (!unread) return [];

    const newest = (await manager.query(
      `SELECT id, sequence, content FROM messages
        WHERE conversation_id = $1 AND sender_id <> $2 AND is_read = false
        ORDER BY sequence DESC LIMIT 1`,
      [conversationId, userId],
    )) as Array<{ id: string; sequence: string; content: string | null }>;

    if (newest.length === 0) {
      const updated = (await manager.query(
        `WITH changed AS (UPDATE notifications
            SET is_read = true, conversation_version = $3,
                updated_at = clock_timestamp()
          WHERE id = $1 AND user_id = $2 AND is_read = false
          RETURNING *) SELECT * FROM changed`,
        [unread.id, userId, conversationVersion],
      )) as NotificationEntity[];
      return updated.map((row) =>
        NotificationsService.toResponse(this.mapRawRow(row)),
      );
    }

    const imageCountRows = (await manager.query(
      `SELECT COUNT(*)::int AS cnt FROM message_images WHERE message_id = $1`,
      [newest[0].id],
    )) as Array<{ cnt: number }>;
    const preview = buildMessagePreview(
      newest[0].content,
      Number(imageCountRows[0]?.cnt ?? 0),
    );
    // No-op guard: notification đã phản ánh đúng tin mới nhất chưa đọc
    // thì không ghi (tránh tăng version/phát event giả khi read lặp lại).
    if (
      unread.body === preview &&
      unread.lastMessageSequence !== null &&
      BigInt(unread.lastMessageSequence) === BigInt(String(newest[0].sequence))
    ) {
      return [];
    }
    const updated = (await manager.query(
      `WITH changed AS (UPDATE notifications
          SET body = $3, last_message_sequence = $4,
              conversation_version = $5, updated_at = clock_timestamp()
        WHERE id = $1 AND user_id = $2 AND is_read = false
        RETURNING *) SELECT * FROM changed`,
      [
        unread.id,
        userId,
        preview,
        String(newest[0].sequence),
        conversationVersion,
      ],
    )) as NotificationEntity[];
    return updated.map((row) =>
      NotificationsService.toResponse(this.mapRawRow(row)),
    );
  }

  // ── Manual reads N3/N4 (không đổi isRead/watermark của messages) ───────────

  async markOneAsRead(
    userId: string,
    notificationId: string,
  ): Promise<{ updated: number; snapshots: NotificationSnapshot[] }> {
    const owned = await this.notificationsRepository.findOneBy({
      id: notificationId,
      userId,
    });
    if (!owned) {
      throw new NotFoundException("Notification not found");
    }
    if (owned.type !== NotificationType.NEW_MESSAGE || !owned.refId) {
      const updated = await this.notificationsRepository.update(
        { id: owned.id, userId, isRead: false },
        { isRead: true },
      );
      return { updated: updated.affected ?? 0, snapshots: [] };
    }

    const conversationId = owned.refId;
    const result = await this.dataSource.transaction(async (manager) => {
      await this.conversationsService.lockForParticipant(
        manager,
        conversationId,
        userId,
      );
      const row = await manager
        .getRepository(NotificationEntity)
        .findOneBy({ id: notificationId, userId });
      if (!row || row.isRead) {
        const conv = await manager
          .getRepository(ConversationEntity)
          .findOneBy({ id: conversationId });
        return {
          updated: 0,
          changed: [] as NotificationResponseDto[],
          version: String(conv?.stateVersion ?? "0"),
        };
      }
      const version = await this.conversationsService.bumpStateVersion(
        manager,
        conversationId,
      );
      const updated = (await manager.query(
        `WITH changed AS (UPDATE notifications
            SET is_read = true, conversation_version = $3,
                updated_at = clock_timestamp()
          WHERE id = $1 AND user_id = $2 AND is_read = false
          RETURNING *) SELECT * FROM changed`,
        [notificationId, userId, version],
      )) as NotificationEntity[];
      const changed = updated.map((r) =>
        NotificationsService.toResponse(this.mapRawRow(r)),
      );
      const snapshot = await this.buildSnapshot(
        manager,
        userId,
        conversationId,
        version,
        changed,
      );
      const convSnapshot = await this.conversationsService.buildSnapshot(
        conversationId,
        userId,
        manager,
      );
      return {
        updated: changed.length,
        changed,
        version,
        snapshot,
        convSnapshot,
      };
    });

    if (result.updated > 0 && result.snapshot && result.convSnapshot) {
      this.emitNotificationRead(userId, result.snapshot, result.convSnapshot);
    }
    return {
      updated: result.updated,
      snapshots: result.snapshot ? [result.snapshot] : [],
    };
  }

  async markAllAsRead(
    userId: string,
  ): Promise<{ updated: number; snapshots: NotificationSnapshot[] }> {
    const targets = (await this.notificationsRepository.query(
      `SELECT DISTINCT ref_id FROM notifications
        WHERE user_id = $1 AND type = 'new_message'
          AND is_read = false AND ref_id IS NOT NULL
        ORDER BY ref_id`,
      [userId],
    )) as Array<{ ref_id: string }>;
    const conversationIds = targets.map((t) => t.ref_id);
    if (conversationIds.length === 0) return { updated: 0, snapshots: [] };

    const result = await this.dataSource.transaction(async (manager) => {
      let updated = 0;
      const snapshots: NotificationSnapshot[] = [];
      const convSnapshots: Array<{
        userId: string;
        snapshot: unknown;
      }> = [];
      // Lock theo id tăng dần, cùng order với writes (spec §5.1).
      for (const conversationId of conversationIds) {
        await this.conversationsService.lockForParticipant(
          manager,
          conversationId,
          userId,
        );
        const unread = await this.findUnread(manager, userId, conversationId);
        if (!unread) continue;
        const version = await this.conversationsService.bumpStateVersion(
          manager,
          conversationId,
        );
        const rows = (await manager.query(
          `WITH changed AS (UPDATE notifications
              SET is_read = true, conversation_version = $3,
                  updated_at = clock_timestamp()
            WHERE user_id = $1 AND type = 'new_message' AND ref_id = $2
              AND is_read = false
            RETURNING *) SELECT * FROM changed`,
          [userId, conversationId, version],
        )) as NotificationEntity[];
        const changed = rows.map((r) =>
          NotificationsService.toResponse(this.mapRawRow(r)),
        );
        updated += changed.length;
        if (changed.length > 0) {
          snapshots.push(
            await this.buildSnapshot(
              manager,
              userId,
              conversationId,
              version,
              changed,
            ),
          );
          const convSnapshot = await this.conversationsService.buildSnapshot(
            conversationId,
            userId,
            manager,
          );
          if (convSnapshot)
            convSnapshots.push({ userId, snapshot: convSnapshot });
        }
      }
      return { updated, snapshots, convSnapshots };
    });

    for (let i = 0; i < result.snapshots.length; i++) {
      const snapshot = result.snapshots[i];
      const conv = result.convSnapshots[i]?.snapshot as
        | import("../conversations/dto/conversation-response.dto").ConversationSnapshotDto
        | undefined;
      if (conv) this.emitNotificationRead(userId, snapshot, conv);
    }
    return { updated: result.updated, snapshots: result.snapshots };
  }

  // ── N1/N2 reads ────────────────────────────────────────────────────────────

  async getList(userId: string, query: PaginationDto) {
    const { page, limit } = query;
    const result = await this.dataSource.transaction(
      "REPEATABLE READ",
      async (manager) => {
        const repo = manager.getRepository(NotificationEntity);
        const [items, total] = await repo.findAndCount({
          where: { userId },
          order: { updatedAt: "DESC", id: "DESC" },
          skip: (page - 1) * limit,
          take: limit,
        });
        const conversationIds = [
          ...new Set(
            items
              .map((n) => n.refId)
              .filter((ref): ref is string => ref !== null),
          ),
        ];
        const snapshots: NotificationSnapshot[] = [];
        if (conversationIds.length > 0) {
          const conversations = await manager
            .getRepository(ConversationEntity)
            .find({
              where: { id: In(conversationIds) },
              select: { id: true, stateVersion: true },
            });
          const unread = await repo.find({
            where: {
              userId,
              type: NotificationType.NEW_MESSAGE,
              refId: In(conversationIds),
              isRead: false,
            },
          });
          const byConversation = new Map(unread.map((row) => [row.refId, row]));
          for (const conversation of conversations) {
            const active = byConversation.get(conversation.id);
            snapshots.push({
              conversationId: conversation.id,
              stateVersion: String(conversation.stateVersion),
              unreadNotification: active
                ? NotificationsService.toResponse(active)
                : null,
              changed: [],
            });
          }
        }
        return {
          items: items.map(NotificationsService.toResponse),
          total,
          snapshots,
        };
      },
    );
    return {
      items: result.items,
      meta: createPaginationMeta(query, result.total),
      snapshots: result.snapshots,
    };
  }

  async getUnreadCount(userId: string): Promise<{ total: number }> {
    const total = await this.notificationsRepository.countBy({
      userId,
      isRead: false,
    });
    return { total };
  }

  // ── Emit helpers ───────────────────────────────────────────────────────────

  private emitNotificationRead(
    userId: string,
    snapshot: NotificationSnapshot,
    convSnapshot: import("../conversations/dto/conversation-response.dto").ConversationSnapshotDto,
  ): void {
    try {
      this.realtime.emitToUser(
        userId,
        WS_EVENTS.NOTIFICATION_CHANGED,
        snapshot,
      );
    } catch (err) {
      this.logger.error(
        `emit notification:changed failed: ${err instanceof Error ? err.message : err}`,
      );
    }
    try {
      this.realtime.emitToUser(
        userId,
        WS_EVENTS.CHAT_CONVERSATION_UPDATED,
        this.conversationsService.toUpdatedPayload(convSnapshot),
      );
    } catch (err) {
      this.logger.error(
        `emit chat:conversation:updated failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /** Raw RETURNING * dùng snake_case; chuẩn hóa về entity để mapper dùng. */
  private mapRawRow(row: NotificationEntity): NotificationEntity {
    const record = row as unknown as Record<string, unknown>;
    if (record["user_id"] !== undefined) {
      const mapped = new NotificationEntity();
      mapped.id = String(record["id"]);
      mapped.userId = String(record["user_id"]);
      mapped.type = record["type"] as NotificationType;
      mapped.refId =
        record["ref_id"] === null || record["ref_id"] === undefined
          ? null
          : String(record["ref_id"]);
      mapped.title = String(record["title"]);
      mapped.body =
        record["body"] === null || record["body"] === undefined
          ? null
          : String(record["body"]);
      mapped.isRead = Boolean(record["is_read"]);
      mapped.lastMessageSequence =
        record["last_message_sequence"] === null ||
        record["last_message_sequence"] === undefined
          ? null
          : String(record["last_message_sequence"]);
      mapped.conversationVersion =
        record["conversation_version"] === null ||
        record["conversation_version"] === undefined
          ? null
          : String(record["conversation_version"]);
      mapped.createdAt = new Date(String(record["created_at"]));
      mapped.updatedAt = new Date(String(record["updated_at"]));
      return mapped;
    }
    return row;
  }
}
