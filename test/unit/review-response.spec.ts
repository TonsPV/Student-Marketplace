import { AuthorizationService } from "../../src/modules/authorization/authorization.service";
import { CaslAbilityFactory } from "../../src/modules/authorization/casl-ability.factory";
import { ReviewsService } from "../../src/modules/reviews/reviews.service";
import { ReviewEditHistoryEntity } from "../../src/modules/reviews/review-edit-history.entity";

const REVIEW = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REVIEW_2 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const POST = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SELLER = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const BUYER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function review(id = REVIEW) {
  return {
    id,
    reviewerId: BUYER,
    postId: POST,
    rating: 4,
    comment: "Good",
    createdAt: new Date("2026-10-01T00:00:00Z"),
    updatedAt: new Date("2026-10-01T00:00:00Z"),
    deletedAt: null,
  };
}

function serviceWith(
  reviews: ReturnType<typeof review>[],
  histories: Record<string, unknown>[] = [],
) {
  const historyFind = jest.fn().mockResolvedValue(histories);
  const historyRepository = { find: historyFind };
  const manager = {
    getRepository: jest.fn((entity) =>
      entity === ReviewEditHistoryEntity ? historyRepository : {},
    ),
  };
  const reviewQueryBuilder = {
    innerJoin: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(reviews[0]),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn().mockResolvedValue([reviews, reviews.length]),
  };
  const reviewRepository = {
    manager,
    findOne: jest.fn().mockResolvedValue(reviews[0]),
    findAndCount: jest.fn().mockResolvedValue([reviews, reviews.length]),
    createQueryBuilder: jest.fn(() => reviewQueryBuilder),
    create: jest.fn((value) => value),
    save: jest.fn().mockImplementation((value) => value),
  };
  const postsRepository = {
    findOne: jest.fn().mockResolvedValue({
      id: POST,
      status: "sold",
      buyerId: BUYER,
      sellerId: SELLER,
      soldAt: new Date(Date.now() + 86400000),
    }),
    findOneBy: jest.fn().mockResolvedValue({
      id: POST,
      status: "sold",
      buyerId: BUYER,
      sellerId: SELLER,
      soldAt: new Date(Date.now() + 86400000),
    }),
  };
  const usersRepository = {
    findOneBy: jest.fn().mockResolvedValue({ id: SELLER }),
  };
  const authorization = new AuthorizationService(new CaslAbilityFactory());
  return {
    service: new ReviewsService(
      reviewRepository as never,
      postsRepository as never,
      usersRepository as never,
      authorization,
    ),
    reviewRepository,
    historyFind,
    authorization,
  };
}

const history = {
  reviewId: REVIEW,
  revision: 1,
  editedAt: new Date("2026-10-05T00:00:00Z"),
};

test("POST review response includes default edit metadata", async () => {
  const { service } = serviceWith([]);
  const context = serviceWith([]).authorization.createAuthenticatedContext({
    id: BUYER,
    email: "buyer@example.com",
    fullName: "Buyer",
    isAdmin: false,
  });

  const result = await service.create(
    { postId: POST, rating: 5, comment: "Great" },
    context,
  );

  expect(result).toMatchObject({ isEdited: false, editedAt: null });
  expect(result).not.toHaveProperty("oldRating");
  expect(result).not.toHaveProperty("newRating");
});

test("GET by ID includes latest edit metadata without history fields", async () => {
  const { service } = serviceWith([review()], [history]);
  const result = await service.findOne(
    REVIEW,
    new AuthorizationService(new CaslAbilityFactory()).createGuestContext(),
  );

  expect(result).toMatchObject({
    isEdited: true,
    editedAt: history.editedAt,
  });
  expect(result).not.toHaveProperty("oldRating");
});

test("post and seller lists batch history metadata for all reviews", async () => {
  const reviews = [review(), review(REVIEW_2)];
  const { service, historyFind, authorization } = serviceWith(reviews, [
    history,
    { ...history, reviewId: REVIEW_2, revision: 2 },
  ]);
  const guest = authorization.createGuestContext();

  const byPost = await service.findByPost(
    POST,
    { page: 1, limit: 20 } as never,
    guest,
  );
  const bySeller = await service.findBySeller(
    SELLER,
    { page: 1, limit: 20 } as never,
    guest,
  );

  expect(byPost.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: REVIEW, isEdited: true }),
      expect.objectContaining({ id: REVIEW_2, isEdited: true }),
    ]),
  );
  expect(bySeller.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: REVIEW, isEdited: true }),
      expect.objectContaining({ id: REVIEW_2, isEdited: true }),
    ]),
  );
  expect(historyFind).toHaveBeenCalledTimes(2);
  expect(byPost.items[0]).not.toHaveProperty("oldRating");
});
