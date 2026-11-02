/**
 * MODULE: POSTS (VÒNG ĐỜI TIN ĐĂNG)
 *
 * WORD TEST CASES:
 * - TC-PSI-01: Từ chối hội thoại buyer có seller khác với seller của tin
 * - TC-PSI-02: Từ chối hội thoại buyer chưa có tin nhắn nào của buyer
 * - TC-PSI-03: Từ chối cho chính seller tự mua tin của mình
 * - TC-PSI-04: Bán hàng cho buyer hợp lệ từ hội thoại của tin
 * - TC-PSI-05: Chỉ emit sau commit; xác nhận lặp lại không gửi thông báo thêm lần nữa
 * - TC-PSI-06: Giao dịch bán vẫn thành công (dữ liệu đã commit) dù realtime delivery lỗi
 * - TC-PSI-07: Không emit lời mời đánh giá nếu lưu dữ liệu lời mời thất bại
 * - TC-PSI-08: Hỗ trợ bán ngoài app (không cần buyer); từ chối dữ liệu purchased không nhất quán
 * - TC-PSI-09: Review đã soft-delete vẫn giữ trạng thái 'đã đánh giá' trong danh sách purchased
 */

import "reflect-metadata";
import { InternalServerErrorException, Logger } from "@nestjs/common";
import { DataSource, Repository } from "typeorm";
import { AuthorizationService } from "../../src/modules/authorization/authorization.service";
import { CaslAbilityFactory } from "../../src/modules/authorization/casl-ability.factory";
import { CategoryEntity } from "../../src/modules/categories/category.entity";
import { ConversationEntity } from "../../src/modules/conversations/entities/conversation.entity";
import { MessageEntity } from "../../src/modules/messages/entities/message.entity";
import { NotificationEntity } from "../../src/modules/notifications/notification.entity";
import { PostEntity, PostStatus } from "../../src/modules/posts/post.entity";
import { PostsService } from "../../src/modules/posts/posts.service";
import { ReviewEntity } from "../../src/modules/reviews/review.entity";
import { StorageService } from "../../src/modules/storage/storage.service";
import { ModerationService } from "../../src/modules/moderation/moderation.service";
import { RealtimeService } from "../../src/modules/realtime/realtime.service";
import { WS_EVENTS } from "../../src/modules/realtime/realtime.events";

const SELLER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BUYER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const POST = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("post sale invariants", () => {
  const authorization = new AuthorizationService(new CaslAbilityFactory());
  const context = authorization.createAuthenticatedContext({
    id: SELLER,
    email: "seller@example.test",
    fullName: "Seller",
    isAdmin: false,
  });

  function createService(
    post: PostEntity,
    conversation: ConversationEntity | null,
    review: ReviewEntity | null = null,
  ) {
    const postQuery = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(post),
    };
    const conversationQuery = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockImplementation(async () => {
        const sellerCondition = conversationQuery.andWhere.mock.calls.find(
          ([condition]) => condition === "conversation.seller_id = :sellerId",
        );
        return conversation &&
          sellerCondition?.[1]?.sellerId === conversation.sellerId
          ? conversation
          : null;
      }),
    };
    const postsRepository = {
      findAndCount: jest.fn().mockResolvedValue([[post], 1]),
      createQueryBuilder: jest.fn().mockReturnValue(postQuery),
      save: jest.fn().mockImplementation(async (value) => value),
    };
    const conversationRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(conversationQuery),
    };
    const reviewRepository = {
      findOneBy: jest.fn().mockResolvedValue(review),
      findOne: jest.fn().mockResolvedValue(review),
    };
    const notificationRepository = {
      findOneBy: jest.fn().mockResolvedValue(null),
      create: jest.fn((value) => value),
      save: jest.fn().mockResolvedValue(undefined),
    };
    const manager = {
      getRepository: jest.fn((entity) => {
        if (entity === PostEntity) return postsRepository;
        if (entity === ConversationEntity) return conversationRepository;
        if (entity === NotificationEntity) return notificationRepository;
        return reviewRepository;
      }),
    };
    let committed = false;
    const dataSource = {
      transaction: jest.fn(async (callback: (value: unknown) => unknown) => {
        const result = await callback(manager);
        committed = true;
        return result;
      }),
    };
    const realtime = { emitToUser: jest.fn() };
    const service = new PostsService(
      postsRepository as unknown as Repository<PostEntity>,
      {} as Repository<CategoryEntity>,
      authorization,
      dataSource as unknown as DataSource,
      {} as StorageService,
      {} as ModerationService,
      conversationRepository as unknown as Repository<ConversationEntity>,
      {} as Repository<MessageEntity>,
      reviewRepository as unknown as Repository<ReviewEntity>,
      realtime as unknown as RealtimeService,
    );
    return {
      service,
      postsRepository,
      conversationQuery,
      notificationRepository,
      realtime,
      committed: () => committed,
    };
  }

  // [WORD-TC: TC-PSI-01]
  // Chức năng: Từ chối hội thoại buyer có seller khác với seller của tin
  it("[TC-PSI-01] Từ chối hội thoại buyer có seller khác với seller của tin", async () => {
    const post = Object.assign(new PostEntity(), {
      id: POST,
      sellerId: SELLER,
      status: PostStatus.ACTIVE,
      deletedAt: null,
    });
    const conversation = Object.assign(new ConversationEntity(), {
      postId: POST,
      buyerId: BUYER,
      sellerId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    });
    const { service, postsRepository, conversationQuery } = createService(
      post,
      conversation,
    );

    await expect(
      service.markAsSold(POST, { buyerId: BUYER }, context),
    ).rejects.toThrow("Buyer has not contacted this post");
    expect(postsRepository.findAndCount).not.toHaveBeenCalled();
    expect(conversationQuery.andWhere).toHaveBeenCalledWith(
      "conversation.seller_id = :sellerId",
      { sellerId: SELLER },
    );
    expect(post.status).toBe(PostStatus.ACTIVE);
  });

  // [WORD-TC: TC-PSI-02]
  // Chức năng: Từ chối hội thoại buyer chưa có tin nhắn nào của buyer
  it("[TC-PSI-02] Từ chối hội thoại buyer chưa có tin nhắn nào của buyer", async () => {
    const post = Object.assign(new PostEntity(), {
      id: POST,
      sellerId: SELLER,
      status: PostStatus.ACTIVE,
      deletedAt: null,
    });
    const { service } = createService(post, null);

    await expect(
      service.markAsSold(POST, { buyerId: BUYER }, context),
    ).rejects.toThrow("Buyer has not contacted this post");
  });

  // [WORD-TC: TC-PSI-03]
  // Chức năng: Từ chối cho chính seller tự mua tin của mình
  it("[TC-PSI-03] Từ chối cho chính seller tự mua tin của mình", async () => {
    const post = Object.assign(new PostEntity(), {
      id: POST,
      sellerId: SELLER,
      status: PostStatus.ACTIVE,
      deletedAt: null,
    });
    const { service } = createService(post, null);

    await expect(
      service.markAsSold(POST, { buyerId: SELLER }, context),
    ).rejects.toThrow("Buyer must be different from seller");
  });

  // [WORD-TC: TC-PSI-04]
  // Chức năng: Bán hàng cho buyer hợp lệ từ hội thoại của tin
  it("[TC-PSI-04] Bán hàng cho buyer hợp lệ từ hội thoại của tin", async () => {
    const post = Object.assign(new PostEntity(), {
      id: POST,
      sellerId: SELLER,
      status: PostStatus.ACTIVE,
      buyerId: null,
      soldAt: null,
      deletedAt: null,
    });
    const conversation = Object.assign(new ConversationEntity(), {
      postId: POST,
      buyerId: BUYER,
      sellerId: SELLER,
    });
    const { service } = createService(post, conversation);

    await expect(
      service.markAsSold(POST, { buyerId: BUYER }, context),
    ).resolves.toMatchObject({
      status: PostStatus.SOLD,
      buyerId: BUYER,
      soldAt: expect.any(Date),
    });
  });

  // [WORD-TC: TC-PSI-05]
  // Chức năng: Chỉ emit sau commit; xác nhận lặp lại không gửi thông báo thêm lần nữa
  it("[TC-PSI-05] Chỉ emit sau commit; xác nhận lặp lại không gửi thông báo thêm lần nữa", async () => {
    const post = Object.assign(new PostEntity(), {
      id: POST,
      sellerId: SELLER,
      status: PostStatus.ACTIVE,
      buyerId: null,
      soldAt: null,
      deletedAt: null,
    });
    const conversation = Object.assign(new ConversationEntity(), {
      postId: POST,
      buyerId: BUYER,
      sellerId: SELLER,
    });
    const state = createService(post, conversation);
    state.realtime.emitToUser.mockImplementation(() => {
      expect(state.committed()).toBe(true);
      expect(state.notificationRepository.save).toHaveBeenCalledTimes(1);
    });
    await state.service.markAsSold(POST, { buyerId: BUYER }, context);
    await state.service.markAsSold(POST, { buyerId: BUYER }, context);
    expect(state.notificationRepository.save).toHaveBeenCalledTimes(1);
    expect(state.realtime.emitToUser).toHaveBeenCalledTimes(1);
    expect(state.realtime.emitToUser).toHaveBeenCalledWith(
      BUYER,
      WS_EVENTS.NOTIFICATION_NEW,
      { type: "review_request", refId: POST },
    );
  });

  // [WORD-TC: TC-PSI-06]
  // Chức năng: Giao dịch bán vẫn thành công (dữ liệu đã commit) dù realtime delivery lỗi
  it("[TC-PSI-06] Giao dịch bán vẫn thành công (dữ liệu đã commit) dù realtime delivery lỗi", async () => {
    const post = Object.assign(new PostEntity(), {
      id: POST,
      sellerId: SELLER,
      status: PostStatus.ACTIVE,
      buyerId: null,
      soldAt: null,
      deletedAt: null,
    });
    const conversation = Object.assign(new ConversationEntity(), {
      postId: POST,
      buyerId: BUYER,
      sellerId: SELLER,
    });
    const state = createService(post, conversation);
    state.realtime.emitToUser.mockImplementation(() => {
      throw new Error("socket failure");
    });
    const log = jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    try {
      await expect(
        state.service.markAsSold(POST, { buyerId: BUYER }, context),
      ).resolves.toMatchObject({ status: PostStatus.SOLD, buyerId: BUYER });
      expect(state.committed()).toBe(true);
      expect(state.notificationRepository.save).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining("socket failure"),
      );
    } finally {
      log.mockRestore();
    }
  });

  // [WORD-TC: TC-PSI-07]
  // Chức năng: Không emit lời mời đánh giá nếu lưu dữ liệu lời mời thất bại
  it("[TC-PSI-07] Không emit lời mời đánh giá nếu lưu dữ liệu lời mời thất bại", async () => {
    const post = Object.assign(new PostEntity(), {
      id: POST,
      sellerId: SELLER,
      status: PostStatus.ACTIVE,
      buyerId: null,
      soldAt: null,
      deletedAt: null,
    });
    const conversation = Object.assign(new ConversationEntity(), {
      postId: POST,
      buyerId: BUYER,
      sellerId: SELLER,
    });
    const state = createService(post, conversation);
    state.notificationRepository.save.mockRejectedValue(
      new Error("database failure"),
    );
    await expect(
      state.service.markAsSold(POST, { buyerId: BUYER }, context),
    ).rejects.toThrow("database failure");
    expect(state.committed()).toBe(false);
    expect(state.realtime.emitToUser).not.toHaveBeenCalled();
  });

  // [WORD-TC: TC-PSI-08]
  // Chức năng: Hỗ trợ bán ngoài app (không cần buyer); từ chối dữ liệu purchased không nhất quán
  it("[TC-PSI-08] Hỗ trợ bán ngoài app (không cần buyer); từ chối dữ liệu purchased không nhất quán", async () => {
    const post = Object.assign(new PostEntity(), {
      id: POST,
      sellerId: SELLER,
      status: PostStatus.ACTIVE,
      buyerId: null,
      soldAt: null,
      deletedAt: null,
    });
    const { service, realtime, notificationRepository } = createService(
      post,
      null,
    );

    await expect(
      service.markAsSold(POST, { buyerId: null }, context),
    ).resolves.toMatchObject({
      status: PostStatus.SOLD,
      buyerId: null,
      soldAt: expect.any(Date),
    });

    expect(notificationRepository.save).not.toHaveBeenCalled();
    expect(realtime.emitToUser).not.toHaveBeenCalled();

    const invalidSoldPost = Object.assign(new PostEntity(), {
      ...post,
      status: PostStatus.SOLD,
      buyerId: BUYER,
      soldAt: null,
    });
    const purchased = createService(invalidSoldPost, null).service;
    await expect(
      purchased.findPurchased({ page: 1, limit: 10 }, context),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  // [WORD-TC: TC-PSI-09]
  // Chức năng: Review đã soft-delete vẫn giữ trạng thái 'đã đánh giá' trong danh sách purchased
  it("[TC-PSI-09] Review đã soft-delete vẫn giữ trạng thái 'đã đánh giá' trong danh sách purchased", async () => {
    const soldAt = new Date();
    const post = Object.assign(new PostEntity(), {
      id: POST,
      sellerId: SELLER,
      categoryId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      title: "Item",
      description: "Description",
      price: "100",
      status: PostStatus.SOLD,
      buyerId: BUYER,
      soldAt,
      location: null,
      locationName: null,
      deletedAt: null,
      seller: { id: SELLER, fullName: "Seller", avatarUrl: null },
      category: { id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", name: "Other" },
    });
    const deletedReview = Object.assign(new ReviewEntity(), {
      id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      postId: POST,
      reviewerId: BUYER,
      rating: 5,
      comment: "Deleted",
      deletedAt: new Date(),
    });
    const { service, postsRepository } = createService(
      post,
      null,
      deletedReview,
    );
    postsRepository.findAndCount.mockResolvedValue([[post], 1]);

    const buyerContext = authorization.createAuthenticatedContext({
      id: BUYER,
      email: "buyer@example.test",
      fullName: "Buyer",
      isAdmin: false,
    });
    const result = await service.findPurchased(
      { page: 1, limit: 10 },
      buyerContext,
    );

    expect(result.items[0]).toMatchObject({
      canReview: false,
      reviewStatus: "REVIEWED",
      review: null,
    });
  });
});
