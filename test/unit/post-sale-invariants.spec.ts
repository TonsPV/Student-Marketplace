import "reflect-metadata";
import { InternalServerErrorException } from "@nestjs/common";
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
    const dataSource = {
      transaction: jest.fn(async (callback: (value: unknown) => unknown) =>
        callback(manager),
      ),
    };
    const service = new PostsService(
      postsRepository as unknown as Repository<PostEntity>,
      {} as Repository<CategoryEntity>,
      authorization,
      dataSource as unknown as DataSource,
      {} as StorageService,
      conversationRepository as unknown as Repository<ConversationEntity>,
      {} as Repository<MessageEntity>,
      reviewRepository as unknown as Repository<ReviewEntity>,
    );
    return {
      service,
      postsRepository,
      conversationQuery,
      notificationRepository,
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

  it("sells outside the app without a buyer and rejects inconsistent purchased data", async () => {
    const post = Object.assign(new PostEntity(), {
      id: POST,
      sellerId: SELLER,
      status: PostStatus.ACTIVE,
      buyerId: null,
      soldAt: null,
      deletedAt: null,
    });
    const { service } = createService(post, null);

    await expect(
      service.markAsSold(POST, { buyerId: null }, context),
    ).resolves.toMatchObject({
      status: PostStatus.SOLD,
      buyerId: null,
      soldAt: expect.any(Date),
    });

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

  it("keeps a soft-deleted review marked as reviewed in purchased posts", async () => {
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
