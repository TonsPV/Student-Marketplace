import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, EntityManager, In, Repository } from "typeorm";
import { uuidv7 } from "uuidv7";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { createPaginationMeta } from "../../common/utils/pagination.util";
import { PostEntity, PostStatus } from "../posts/post.entity";
import { UserEntity } from "../user/user.entity";
import { ConversationEntity } from "./entities/conversation.entity";
import { CreateConversationDto } from "./dto/create-conversation.dto";
import {
  ConversationSnapshotDto,
  ConversationUpdatedPayload,
} from "./dto/conversation-response.dto";

@Injectable()
export class ConversationsService {
  constructor(
    @InjectRepository(ConversationEntity)
    private readonly conversationsRepository: Repository<ConversationEntity>,
    @InjectRepository(PostEntity)
    private readonly postsRepository: Repository<PostEntity>,
    private readonly dataSource: DataSource,
  ) {}

  // ── Authorization helpers (public, dùng bởi Messages/Notifications/Gateway) ──
  // Chỉ kiểm tra conversation tồn tại và user là buyer/seller.
  // Tuyệt đối KHÔNG query Post.status hay Post.deletedAt ở đây.

  async assertParticipant(
    conversationId: string,
    userId: string,
    manager?: EntityManager,
  ): Promise<ConversationEntity> {
    const repo = manager
      ? manager.getRepository(ConversationEntity)
      : this.conversationsRepository;
    const conv = await repo.findOneBy({ id: conversationId });
    if (!conv) throw new NotFoundException("Conversation not found");
    if (conv.buyerId !== userId && conv.sellerId !== userId) {
      throw new ForbiddenException(
        "You are not a participant of this conversation",
      );
    }
    return conv;
  }

  /**
   * Khóa row conversation (SELECT ... FOR UPDATE, không join relations
   * trong câu khóa). Chỉ gọi trong transaction.
   */
  async lockForParticipant(
    manager: EntityManager,
    conversationId: string,
    userId: string,
  ): Promise<ConversationEntity> {
    const conv = await manager
      .getRepository(ConversationEntity)
      .createQueryBuilder("conv")
      .setLock("pessimistic_write")
      .where("conv.id = :id", { id: conversationId })
      .getOne();
    if (!conv) throw new NotFoundException("Conversation not found");
    if (conv.buyerId !== userId && conv.sellerId !== userId) {
      throw new ForbiddenException(
        "You are not a participant of this conversation",
      );
    }
    return conv;
  }

  async isParticipant(
    conversationId: string,
    userId: string,
  ): Promise<boolean> {
    const conv = await this.conversationsRepository.findOne({
      select: ["id", "buyerId", "sellerId"],
      where: { id: conversationId },
    });
    if (!conv) return false;
    return conv.buyerId === userId || conv.sellerId === userId;
  }

  /** Tăng version bigint-string; watermark/version không bao giờ giảm. */
  static nextVersion(current: string): string {
    return (BigInt(current) + 1n).toString();
  }

  /**
   * Tăng state_version sau khi đã giữ row lock. Trả version mới (string).
   * Caller đã bump version cùng UPDATE metadata thì dùng đúng version đó,
   * không gọi thêm lần hai (spec §6.2).
   */
  async bumpStateVersion(
    manager: EntityManager,
    conversationId: string,
  ): Promise<string> {
    await manager.query(
      `UPDATE conversations SET state_version = state_version + 1 WHERE id = $1`,
      [conversationId],
    );
    const rows = await manager.query(
      `SELECT state_version FROM conversations WHERE id = $1`,
      [conversationId],
    );
    return String(rows[0].state_version);
  }

  // ── findOrCreate (dùng trong transaction send) ─────────────────────────────

  /**
   * READ COMMITTED: SELECT → INSERT ... ON CONFLICT DO NOTHING (id uuidv7
   * rõ ràng vì raw insert không chạy @BeforeInsert) → SELECT row thắng race.
   * Trả row chưa khóa; caller tiếp tục lockForParticipant rồi mới dùng
   * counters/metadata (spec §5.2).
   */
  async findOrCreateConversation(
    postId: string,
    buyerId: string,
    sellerId: string,
    manager: EntityManager,
  ): Promise<ConversationEntity> {
    const repo = manager.getRepository(ConversationEntity);
    const existing = await repo.findOneBy({ postId, buyerId });
    if (existing) return existing;

    await manager.query(
      `INSERT INTO conversations
         (id, post_id, buyer_id, seller_id, last_message, last_message_at,
          last_message_id, last_message_sender_id, last_message_sequence,
          state_version, buyer_read_sequence, seller_read_sequence,
          created_at, updated_at)
       VALUES ($1, $2, $3, $4, NULL, NULL, NULL, NULL, '0', '0', '0', '0',
               clock_timestamp(), clock_timestamp())
       ON CONFLICT (post_id, buyer_id) DO NOTHING`,
      [uuidv7(), postId, buyerId, sellerId],
    );
    const winner = await repo.findOneBy({ postId, buyerId });
    if (!winner) {
      throw new NotFoundException("Conversation not found after create");
    }
    return winner;
  }

  // ── createConversation (E8 → ConversationSnapshotDto) ──────────────────────

  async createConversation(
    dto: CreateConversationDto,
    buyerId: string,
  ): Promise<ConversationSnapshotDto> {
    const { postId } = dto;
    const created = await this.dataSource.transaction(async (manager) => {
      // Serialize việc kiểm tra với post status update: giữ FOR SHARE
      // trên row post cho nhánh mở mới (spec §5.2). Bỏ qua post đã soft-delete.
      const postRows: Array<{
        id: string;
        seller_id: string;
        status: PostStatus;
      }> = await manager.query(
        `SELECT id, seller_id, status FROM posts
          WHERE id = $1 AND deleted_at IS NULL FOR SHARE`,
        [postId],
      );
      const post = postRows[0];
      if (!post || post.status !== PostStatus.ACTIVE) {
        throw new NotFoundException("Post not found or not available");
      }
      if (post.seller_id === buyerId) {
        throw new BadRequestException(
          "You cannot start a conversation about your own post",
        );
      }
      return this.findOrCreateConversation(
        postId,
        buyerId,
        post.seller_id,
        manager,
      );
    });
    const snapshot = await this.buildSnapshot(created.id, buyerId);
    if (!snapshot) throw new NotFoundException("Conversation not found");
    return snapshot;
  }

  // ── Snapshots (list/detail/event dùng chung) ───────────────────────────────

  async findAll(userId: string, query: PaginationDto) {
    const { page, limit } = query;
    const result = await this.dataSource.transaction(
      "REPEATABLE READ",
      async (manager) => {
        const [convs, total] = await manager
          .getRepository(ConversationEntity)
          .createQueryBuilder("conv")
          .where("conv.buyerId = :userId OR conv.sellerId = :userId", {
            userId,
          })
          .orderBy("conv.lastMessageAt", "DESC", "NULLS LAST")
          .addOrderBy("conv.createdAt", "DESC")
          .addOrderBy("conv.id", "DESC")
          .skip((page - 1) * limit)
          .take(limit)
          .getManyAndCount();
        const items = await this.mapSnapshots(manager, convs, userId);
        return { items, total };
      },
    );
    return {
      items: result.items,
      meta: createPaginationMeta(query, result.total),
    };
  }

  async findOne(
    conversationId: string,
    userId: string,
  ): Promise<ConversationSnapshotDto> {
    await this.assertParticipant(conversationId, userId);
    const snapshot = await this.dataSource.transaction(
      "REPEATABLE READ",
      async (manager) => {
        const conv = await manager
          .getRepository(ConversationEntity)
          .findOneBy({ id: conversationId });
        if (!conv) return null;
        const mapped = await this.mapSnapshots(manager, [conv], userId);
        return mapped[0] ?? null;
      },
    );
    if (!snapshot) throw new NotFoundException("Conversation not found");
    return snapshot;
  }

  /** Snapshot đơn cho event/REST sau mutation (đọc trong tx caller khi có thể). */
  async buildSnapshot(
    conversationId: string,
    userId: string,
    manager?: EntityManager,
  ): Promise<ConversationSnapshotDto | null> {
    const run = async (em: EntityManager) => {
      const conv = await em
        .getRepository(ConversationEntity)
        .findOneBy({ id: conversationId });
      if (!conv) return null;
      const mapped = await this.mapSnapshots(em, [conv], userId);
      return mapped[0] ?? null;
    };
    if (manager) return run(manager);
    return this.dataSource.transaction("REPEATABLE READ", run);
  }

  /**
   * Batch snapshots cho nhiều conversation của cùng một user trong cùng
   * manager snapshot: metadata + grouped unread + thumbnails, không N+1.
   */
  async mapSnapshots(
    manager: EntityManager,
    convs: ConversationEntity[],
    userId: string,
  ): Promise<ConversationSnapshotDto[]> {
    if (convs.length === 0) return [];
    const convIds = convs.map((c) => c.id);
    const postIds = [...new Set(convs.map((c) => c.postId))];
    const userIds = [...new Set(convs.flatMap((c) => [c.buyerId, c.sellerId]))];

    // A transactional manager owns one pg connection: query sequentially.
    const posts = await manager.getRepository(PostEntity).find({
      where: { id: In(postIds) },
      withDeleted: true,
      select: { id: true, title: true, price: true, status: true },
    });
    const users = await manager.getRepository(UserEntity).find({
      where: { id: In(userIds) },
      withDeleted: true,
      select: { id: true, fullName: true, avatarUrl: true },
    });
    const unreadRows = (await manager.query(
      `SELECT conversation_id, COUNT(*)::int AS cnt
           FROM messages
          WHERE conversation_id = ANY($1::uuid[])
            AND sender_id <> $2
            AND is_read = false
          GROUP BY conversation_id`,
      [convIds, userId],
    )) as Array<{ conversation_id: string; cnt: number }>;
    const thumbRows = (await manager.query(
      `SELECT DISTINCT ON (post_id) post_id, url
           FROM post_image
          WHERE post_id = ANY($1::uuid[])
          ORDER BY post_id, id`,
      [postIds],
    )) as Array<{ post_id: string; url: string }>;

    const postById = new Map(posts.map((p) => [p.id, p]));
    const userById = new Map(users.map((u) => [u.id, u]));
    const unreadByConv = new Map(
      unreadRows.map((r) => [r.conversation_id, Number(r.cnt)]),
    );
    const thumbByPost = new Map(thumbRows.map((r) => [r.post_id, r.url]));

    return convs.map((conv) => {
      const isBuyer = conv.buyerId === userId;
      const counterpartId = isBuyer ? conv.sellerId : conv.buyerId;
      const counterpart = userById.get(counterpartId);
      const post = postById.get(conv.postId);
      return {
        id: conv.id,
        post: {
          id: post?.id ?? conv.postId,
          title: post?.title ?? "",
          price: post ? String(post.price) : "0",
          status: post?.status ?? "unknown",
          thumbnailUrl: thumbByPost.get(conv.postId) ?? null,
        },
        counterpart: {
          id: counterpart?.id ?? counterpartId,
          fullName: counterpart?.fullName ?? "",
          avatarUrl: counterpart?.avatarUrl ?? null,
        },
        role: isBuyer ? ("buyer" as const) : ("seller" as const),
        lastMessageId: conv.lastMessageId,
        lastMessage: conv.lastMessage,
        lastMessageAt: conv.lastMessageAt,
        lastMessageSenderId: conv.lastMessageSenderId,
        lastMessageSequence: String(conv.lastMessageSequence),
        stateVersion: String(conv.stateVersion),
        unreadCount: unreadByConv.get(conv.id) ?? 0,
        buyerReadSequence: String(conv.buyerReadSequence),
        sellerReadSequence: String(conv.sellerReadSequence),
        createdAt: conv.createdAt,
      };
    });
  }

  toUpdatedPayload(
    snapshot: ConversationSnapshotDto,
  ): ConversationUpdatedPayload {
    return {
      conversationId: snapshot.id,
      stateVersion: snapshot.stateVersion,
      lastMessageId: snapshot.lastMessageId,
      lastMessage: snapshot.lastMessage,
      lastMessageAt: snapshot.lastMessageAt,
      lastMessageSenderId: snapshot.lastMessageSenderId,
      lastMessageSequence: snapshot.lastMessageSequence,
      unreadCount: snapshot.unreadCount,
      buyerReadSequence: snapshot.buyerReadSequence,
      sellerReadSequence: snapshot.sellerReadSequence,
    };
  }

  // ── Counts ─────────────────────────────────────────────────────────────────

  async getUnreadCount(
    userId: string,
  ): Promise<{ total: number; conversations: number }> {
    const rows = (await this.conversationsRepository.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(DISTINCT m.conversation_id)::int AS conversations
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
        WHERE (c.buyer_id = $1 OR c.seller_id = $1)
          AND m.sender_id <> $1
          AND m.is_read = false`,
      [userId],
    )) as Array<{ total: number; conversations: number }>;
    return {
      total: Number(rows[0]?.total ?? 0),
      conversations: Number(rows[0]?.conversations ?? 0),
    };
  }
}
