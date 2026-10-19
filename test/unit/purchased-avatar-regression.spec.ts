import "reflect-metadata";
import { DataSource, Repository } from "typeorm";
import { AuthorizationService } from "../../src/modules/authorization/authorization.service";
import { CaslAbilityFactory } from "../../src/modules/authorization/casl-ability.factory";
import { CategoryEntity } from "../../src/modules/categories/category.entity";
import { ConversationEntity } from "../../src/modules/conversations/entities/conversation.entity";
import { MessageEntity } from "../../src/modules/messages/entities/message.entity";
import { PostEntity, PostStatus } from "../../src/modules/posts/post.entity";
import { PostsService } from "../../src/modules/posts/posts.service";
import { ReviewEntity } from "../../src/modules/reviews/review.entity";
import { StorageService } from "../../src/modules/storage/storage.service";

// F2-01 regression (audit): merge 19a695c dropped `avatarStorageKey` from the
// `seller` select of PostsService.findPurchased (present in BOTH parents), so
// resolveAvatar() can never presign a storage avatar in this flow.
//
// The "regression detector" test below intentionally FAILS against HEAD
// 23294bf. Do not weaken the assertion to make the suite green: the fix is to
// restore `avatarStorageKey: true` in the select (production change, out of
// audit scope).
const SELLER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BUYER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const POST = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SIGNED_URL = "https://signed.example.test/avatars/presigned?sig=abc";
const PLAIN_URL = "https://cdn.example.test/plain-avatar.png";
// avatars/<owner-uuid>/<object-uuid>.jpg — matches AVATAR_IMAGE_KEY_REGEX and
// the ownership check (owner segment === seller id, lowercase).
const OWNED_KEY = `avatars/${SELLER}/11111111-2222-4333-8444-555555555555.jpg`;

describe("purchased posts seller avatar (F2-01 regression)", () => {
  const authorization = new AuthorizationService(new CaslAbilityFactory());
  const buyerContext = authorization.createAuthenticatedContext({
    id: BUYER,
    email: "buyer@example.test",
    fullName: "Buyer",
    isAdmin: false,
  });

  /** Sold post fixture; `seller` shape is injected per test case. */
  function soldPost(seller: Record<string, unknown>): PostEntity {
    return Object.assign(new PostEntity(), {
      id: POST,
      sellerId: SELLER,
      categoryId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      title: "Item",
      description: "Description",
      price: "100",
      status: PostStatus.SOLD,
      buyerId: BUYER,
      soldAt: new Date(),
      location: null,
      locationName: null,
      deletedAt: null,
      seller,
      category: { id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", name: "Other" },
    });
  }

  function setup(post: PostEntity) {
    const postsRepository = {
      findAndCount: jest.fn().mockResolvedValue([[post], 1]),
    };
    const reviewRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      findOneBy: jest.fn().mockResolvedValue(null),
    };
    const storage = {
      presignGet: jest.fn().mockResolvedValue({
        url: SIGNED_URL,
        expiresAt: "2099-01-01T00:00:00.000Z",
      }),
    };
    const dataSource = {
      transaction: jest.fn(),
      getRepository: jest.fn(() => reviewRepository),
    };
    const service = new PostsService(
      postsRepository as unknown as Repository<PostEntity>,
      {} as Repository<CategoryEntity>,
      authorization,
      dataSource as unknown as DataSource,
      storage as unknown as StorageService,
      {} as Repository<ConversationEntity>,
      {} as Repository<MessageEntity>,
      reviewRepository as unknown as Repository<ReviewEntity>,
    );
    return { service, postsRepository, storage };
  }

  it("R1 detector: findPurchased select must include seller.avatarStorageKey", async () => {
    const post = soldPost({
      id: SELLER,
      fullName: "Seller",
      avatarUrl: null,
      avatarStorageKey: OWNED_KEY,
    });
    const { service, postsRepository } = setup(post);
    await service.findPurchased({ page: 1, limit: 10 }, buyerContext);

    const options = postsRepository.findAndCount.mock.calls[0][0] as {
      select: { seller: Record<string, unknown> };
    };
    // Regression F2-01: at HEAD 23294bf this object is
    // { id, fullName, avatarUrl } — the storage key never reaches the row.
    expect(options.select.seller).toHaveProperty("avatarStorageKey", true);
  });

  it("R1 impact: seller row shaped by the current select (no storage key, null url) yields no presigned avatar", async () => {
    // This shape is what TypeORM returns under the current select:
    // id/fullName/avatarUrl only — see merge diff 19a695c (F2-01).
    const post = soldPost({
      id: SELLER,
      fullName: "Seller",
      avatarUrl: null,
    });
    const { service, storage } = setup(post);

    const result = await service.findPurchased(
      { page: 1, limit: 10 },
      buyerContext,
    );

    expect(storage.presignGet).not.toHaveBeenCalled();
    expect(result.items[0].seller).toMatchObject({ avatarUrl: null });
  });

  it("R1 mapper sanity: when the storage key reaches the mapper, a signed avatar is returned", async () => {
    const post = soldPost({
      id: SELLER,
      fullName: "Seller",
      avatarUrl: null,
      avatarStorageKey: OWNED_KEY,
    });
    const { service, storage } = setup(post);

    const result = await service.findPurchased(
      { page: 1, limit: 10 },
      buyerContext,
    );

    expect(storage.presignGet).toHaveBeenCalledTimes(1);
    expect(storage.presignGet).toHaveBeenCalledWith(OWNED_KEY);
    expect(result.items[0].seller).toMatchObject({
      avatarUrl: SIGNED_URL,
      avatarUrlExpiresAt: "2099-01-01T00:00:00.000Z",
    });
  });

  it("R2: seller with a plain avatarUrl keeps it without presigning", async () => {
    const post = soldPost({
      id: SELLER,
      fullName: "Seller",
      avatarUrl: PLAIN_URL,
    });
    const { service, storage } = setup(post);

    const result = await service.findPurchased(
      { page: 1, limit: 10 },
      buyerContext,
    );

    expect(storage.presignGet).not.toHaveBeenCalled();
    expect(result.items[0].seller).toMatchObject({ avatarUrl: PLAIN_URL });
  });

  it("R3: seller without any avatar data resolves to null avatarUrl", async () => {
    const post = soldPost({ id: SELLER, fullName: "Seller" });
    const { service, storage } = setup(post);

    const result = await service.findPurchased(
      { page: 1, limit: 10 },
      buyerContext,
    );

    expect(storage.presignGet).not.toHaveBeenCalled();
    expect(result.items[0].seller).toMatchObject({ avatarUrl: null });
  });
});
