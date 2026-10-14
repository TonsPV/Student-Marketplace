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

  it("rejects a buyer conversation whose seller differs from the post seller", async () => {
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

  it("rejects a buyer conversation without a buyer message", async () => {
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

  it("rejects the seller as the buyer", async () => {
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

  it("sells to a buyer from the post's conversation", async () => {
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

  it("emits only after commit, and repeat confirmation does not notify again", async () => {
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

  it("returns the committed sale if realtime delivery throws", async () => {
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

  it("does not emit an invitation if its persistence fails", async () => {
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

  it("sells outside the app without a buyer and rejects inconsistent purchased data", async () => {
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
});
