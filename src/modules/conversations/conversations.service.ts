import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
  DataSource,
  EntityManager,
  QueryFailedError,
  Repository,
} from "typeorm";

import { PostEntity, PostStatus } from "../posts/post.entity";
import { ConversationEntity } from "./entities/conversation.entity";
import { MessageEntity } from "./entities/message.entity";
import { CreateConversationDto } from "./dto/create-conversation.dto";
import { FilterConversationDto } from "./dto/filter-conversation.dto";
import { FilterMessageDto } from "./dto/filter-message.dto";
import { SendMessageDto } from "./dto/send-message.dto";

// PostgreSQL unique violation error code
const PG_UNIQUE_VIOLATION = "23505";

@Injectable()
export class ConversationsService {
  constructor(
    @InjectRepository(ConversationEntity)
    private readonly conversationsRepository: Repository<ConversationEntity>,
    @InjectRepository(MessageEntity)
    private readonly messagesRepository: Repository<MessageEntity>,
    @InjectRepository(PostEntity)
    private readonly postsRepository: Repository<PostEntity>,
    private readonly dataSource: DataSource,
  ) {}

  // ── Helper: authorize participant ────────────────────────────────────────────
  // Tuyệt đối KHÔNG query Post.status hay Post.deletedAt ở đây.
  // Chỉ kiểm tra conversation tồn tại và userId là buyer hoặc seller.

  private async getConversationForParticipant(
    conversationId: string,
    userId: string,
    manager?: EntityManager,
  ): Promise<ConversationEntity> {
    const repo = manager
      ? manager.getRepository(ConversationEntity)
      : this.conversationsRepository;

    const conv = await repo.findOneBy({ id: conversationId });
    if (!conv) throw new NotFoundException("Conversation not found");
    if (conv.buyerId !== userId && conv.sellerId !== userId)
      throw new ForbiddenException(
        "You are not a participant of this conversation",
      );
    return conv;
  }

  // ── createConversation ───────────────────────────────────────────────────────

  async createConversation(dto: CreateConversationDto, buyerId: string) {
    const { postId } = dto;
    const post = await this.postsRepository.findOneBy({ id: postId });
    if (!post || post.status !== PostStatus.ACTIVE) {
      throw new NotFoundException("Post not found or not available");
    }

    if (post.sellerId === buyerId) {
      throw new BadRequestException(
        "You cannot start a conversation about your own post",
      );
    }

    const sellerId = post.sellerId;

    const existing = await this.conversationsRepository.findOneBy({
      postId,
      buyerId,
    });
    if (existing) return existing;

    // 5. Attempt insert
    const conv = this.conversationsRepository.create({
      postId,
      buyerId,
      sellerId,
      lastMessage: null,
      lastMessageAt: null,
    });

    try {
      return await this.conversationsRepository.save(conv);
    } catch (err) {
      // 6. Unique violation on uq_conversations_post_buyer → race condition
      const driverError =
        err instanceof QueryFailedError
          ? (err.driverError as { code?: string; constraint?: string })
          : undefined;

      if (
        driverError?.code === PG_UNIQUE_VIOLATION &&
        driverError.constraint === "uq_conversations_post_buyer"
      ) {
        const raceWinner = await this.conversationsRepository.findOneBy({
          postId,
          buyerId,
        });
        if (raceWinner) return raceWinner;
      }
      // 7. Rethrow other errors
      throw err;
    }
  }

  // ── findAll ──────────────────────────────────────────────────────────────────
  // QueryBuilder bắt buộc để filter DB-side và load historical soft-deleted
  // Post/Buyer/Seller an toàn.

  async findAll(userId: string, query: FilterConversationDto) {
    const { page, limit } = query;

    const [items, total] = await this.conversationsRepository
      .createQueryBuilder("conv")
      // withDeleted trên alias chính để LEFT JOIN vẫn nạp soft-deleted relations
      .withDeleted()
      .leftJoin("conv.post", "post")
      .leftJoin("conv.buyer", "buyer")
      .leftJoin("conv.seller", "seller")
      // Chỉ select các field cần thiết; không select password / token
      .select([
        "conv.id",
        "conv.postId",
        "conv.buyerId",
        "conv.sellerId",
        "conv.lastMessage",
        "conv.lastMessageAt",
        "conv.createdAt",
        "conv.updatedAt",
        "post.id",
        "post.title",
        "post.price",
        "post.status",
        "buyer.id",
        "buyer.fullName",
        "buyer.avatarUrl",
        "seller.id",
        "seller.fullName",
        "seller.avatarUrl",
      ])
      // Filter DB-side — không filter ở application layer
      .where("conv.buyerId = :userId OR conv.sellerId = :userId", { userId })
      // Sort: lastMessageAt DESC NULLS LAST, sau đó createdAt DESC
      .orderBy("conv.lastMessageAt", "DESC", "NULLS LAST")
      .addOrderBy("conv.createdAt", "DESC")
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      items,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ── findOne ──────────────────────────────────────────────────────────────────
  // QueryBuilder với withDeleted() để load historical metadata an toàn.
  // Authorize participant trước; không filter Post.status hay deletedAt.

  async findOne(conversationId: string, userId: string) {
    // Authorize: chỉ kiểm tra participant
    await this.getConversationForParticipant(conversationId, userId);

    // Load full detail với historical relations
    const conv = await this.conversationsRepository
      .createQueryBuilder("conv")
      .withDeleted()
      .leftJoin("conv.post", "post")
      .leftJoin("conv.buyer", "buyer")
      .leftJoin("conv.seller", "seller")
      .select([
        "conv.id",
        "conv.postId",
        "conv.buyerId",
        "conv.sellerId",
        "conv.lastMessage",
        "conv.lastMessageAt",
        "conv.createdAt",
        "conv.updatedAt",
        "post.id",
        "post.title",
        "post.price",
        "post.status",
        "buyer.id",
        "buyer.fullName",
        "buyer.avatarUrl",
        "seller.id",
        "seller.fullName",
        "seller.avatarUrl",
      ])
      .where("conv.id = :conversationId", { conversationId })
      .getOne();

    if (!conv) throw new NotFoundException("Conversation not found");
    return conv;
  }

  // ── findMessages ─────────────────────────────────────────────────────────────

  async findMessages(
    conversationId: string,
    userId: string,
    query: FilterMessageDto,
  ) {
    const { page, limit } = query;

    // Authorize participant; không kiểm tra Post status
    await this.getConversationForParticipant(conversationId, userId);

    const [items, total] = await this.messagesRepository.findAndCount({
      where: { conversationId },
      order: { createdAt: "DESC" },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      items,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ── sendMessage ──────────────────────────────────────────────────────────────
  // Transaction: authorize → INSERT Message → UPDATE Conversation metadata
  // Không dùng injected repository bên ngoài transaction.

  async sendMessage(
    conversationId: string,
    senderId: string,
    dto: SendMessageDto,
  ) {
    return this.dataSource.transaction(async (manager) => {
      // Authorize bằng helper với repository từ cùng EntityManager
      await this.getConversationForParticipant(
        conversationId,
        senderId,
        manager,
      );

      // INSERT Message
      const msgRepo = manager.getRepository(MessageEntity);
      const message = msgRepo.create({
        conversationId,
        senderId,
        content: dto.content,
        isRead: false,
      });
      const savedMessage = await msgRepo.save(message);

      // UPDATE Conversation metadata
      await manager.update(ConversationEntity, conversationId, {
        lastMessage: dto.content,
        lastMessageAt: savedMessage.createdAt,
      });

      return savedMessage;
    });
  }

  // ── markAsRead ───────────────────────────────────────────────────────────────
  // Chỉ update message từ participant còn lại (senderId !== currentUserId) chưa đọc.

  async markAsRead(conversationId: string, userId: string) {
    // Authorize participant
    await this.getConversationForParticipant(conversationId, userId);

    const result = await this.dataSource
      .createQueryBuilder()
      .update(MessageEntity)
      .set({ isRead: true })
      .where(
        "conversationId = :conversationId AND senderId != :userId AND isRead = false",
        { conversationId, userId },
      )
      .execute();

    return { updated: result.affected ?? 0 };
  }
}
