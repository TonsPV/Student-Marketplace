import { ReviewsService } from "../../src/modules/reviews/reviews.service";
import { ReviewEntity } from "../../src/modules/reviews/review.entity";
import { AuthorizationService } from "../../src/modules/authorization/authorization.service";
import { CaslAbilityFactory } from "../../src/modules/authorization/casl-ability.factory";
const REVIEW = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  OWNER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  POST = "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  OTHER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
it("empty/undefined review patches are rejected after instance authorization, before save", async () => {
  const authorization = new AuthorizationService(new CaslAbilityFactory()),
    save = jest.fn(),
    queryBuilder = {
      where: jest.fn().mockReturnThis(),
      setLock: jest.fn().mockReturnThis(),
      withDeleted: jest.fn().mockReturnThis(),
      getOne: jest
        .fn()
        .mockResolvedValue({ id: REVIEW, reviewerId: OWNER, postId: POST }),
    },
    manager = {
      getRepository: jest.fn(() => ({
        createQueryBuilder: jest.fn(() => queryBuilder),
      })),
    },
    transaction = jest
      .fn()
      .mockImplementation((callback: (value: typeof manager) => unknown) =>
        callback(manager),
      );
  const service = new ReviewsService(
    {
      manager: { transaction },
      save,
    } as never,
    {} as never,
    {} as never,
    authorization,
  );
  const context = (id: string) =>
    authorization.createAuthenticatedContext({
      id,
      email: "test@example.com",
      fullName: "Test",
      isAdmin: false,
    });
  await expect(
    service.update(
      REVIEW,
      { rating: undefined, comment: undefined },
      context(OWNER),
    ),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    service.update(REVIEW, {}, context(OTHER)),
  ).rejects.toMatchObject({ status: 403 });
  expect(save).not.toHaveBeenCalled();
});
it("uppercase server principal and raw instance IDs normalize consistently for fields", () => {
  const authorization = new AuthorizationService(new CaslAbilityFactory()),
    context = authorization.createAuthenticatedContext({
      id: OWNER.toUpperCase(),
      email: "test@example.com",
      fullName: "Test",
      isAdmin: false,
    });
  expect(context.principal.id).toBe(OWNER);
  expect(() =>
    authorization.assertUpdateFields(
      context,
      "update",
      "Review",
      { id: REVIEW, reviewerId: OWNER.toUpperCase(), postId: POST },
      { comment: null },
    ),
  ).not.toThrow();
});

it("rejects updates and deletes for soft-deleted reviews", async () => {
  const authorization = new AuthorizationService(new CaslAbilityFactory()),
    queryBuilder = {
      where: jest.fn().mockReturnThis(),
      setLock: jest.fn().mockReturnThis(),
      withDeleted: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({
        id: REVIEW,
        reviewerId: OWNER,
        postId: POST,
        deletedAt: new Date(),
      }),
    },
    reviewRepository = { createQueryBuilder: jest.fn(() => queryBuilder) },
    manager = {
      getRepository: jest.fn(() => reviewRepository),
    },
    transaction = jest
      .fn()
      .mockImplementation((callback: (value: typeof manager) => unknown) =>
        callback(manager),
      ),
    save = jest.fn(),
    softRemove = jest.fn();
  const service = new ReviewsService(
    { manager: { transaction }, save, softRemove } as never,
    {} as never,
    {} as never,
    authorization,
  );
  const context = authorization.createAuthenticatedContext({
    id: OWNER,
    email: "test@example.com",
    fullName: "Test",
    isAdmin: false,
  });

  await expect(
    service.update(REVIEW, { rating: 5 }, context),
  ).rejects.toMatchObject({ status: 404 });
  await expect(service.remove(REVIEW, context)).rejects.toMatchObject({
    status: 404,
  });
  expect(save).not.toHaveBeenCalled();
  expect(softRemove).not.toHaveBeenCalled();
});

it("updates and records a revision in one transaction", async () => {
  const authorization = new AuthorizationService(new CaslAbilityFactory()),
    review = {
      id: REVIEW,
      reviewerId: OWNER,
      postId: POST,
      rating: 3,
      comment: "old",
      deletedAt: null,
    },
    queryBuilder = {
      where: jest.fn().mockReturnThis(),
      setLock: jest.fn().mockReturnThis(),
      withDeleted: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(review),
    },
    savedHistory: Record<string, unknown>[] = [],
    reviewRepository = {
      createQueryBuilder: jest.fn(() => queryBuilder),
      save: jest.fn().mockImplementation((value) => value),
    },
    historyRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((value) => value),
      save: jest.fn().mockImplementation((value) => {
        value.editedAt = new Date("2026-10-05T00:00:00Z");
        savedHistory.push(value);
        return value;
      }),
    },
    manager = {
      getRepository: jest.fn((entity) =>
        entity === ReviewEntity ? reviewRepository : historyRepository,
      ),
    },
    transaction = jest
      .fn()
      .mockImplementation((callback: (value: typeof manager) => unknown) =>
        callback(manager),
      );
  const service = new ReviewsService(
    { manager: { transaction } } as never,
    {} as never,
    {} as never,
    authorization,
  );
  const context = authorization.createAuthenticatedContext({
    id: OWNER,
    email: "test@example.com",
    fullName: "Test",
    isAdmin: false,
  });

  const result = await service.update(
    REVIEW,
    { rating: 5, comment: "new" },
    context,
  );

  expect(transaction).toHaveBeenCalledTimes(1);
  expect(reviewRepository.save).toHaveBeenCalledWith(review);
  expect(result).toMatchObject({
    isEdited: true,
    editedAt: expect.anything(),
  });
  expect(savedHistory).toEqual([
    expect.objectContaining({
      reviewId: REVIEW,
      editorId: OWNER,
      oldRating: 3,
      newRating: 5,
      oldComment: "old",
      newComment: "new",
      revision: 1,
      editedAt: new Date("2026-10-05T00:00:00Z"),
    }),
  ]);
});

it("does not save or create history for a no-op patch", async () => {
  const authorization = new AuthorizationService(new CaslAbilityFactory()),
    review = {
      id: REVIEW,
      reviewerId: OWNER,
      postId: POST,
      rating: 3,
      comment: "same",
      deletedAt: null,
    },
    queryBuilder = {
      where: jest.fn().mockReturnThis(),
      setLock: jest.fn().mockReturnThis(),
      withDeleted: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(review),
    },
    reviewRepository = {
      createQueryBuilder: jest.fn(() => queryBuilder),
      save: jest.fn(),
    },
    historyRepository = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([
        {
          reviewId: REVIEW,
          revision: 1,
          editedAt: new Date("2026-10-05T00:00:00Z"),
        },
      ]),
      create: jest.fn(),
      save: jest.fn(),
    },
    manager = {
      getRepository: jest.fn((entity) =>
        entity === ReviewEntity ? reviewRepository : historyRepository,
      ),
    },
    transaction = jest
      .fn()
      .mockImplementation((callback: (value: typeof manager) => unknown) =>
        callback(manager),
      );
  const service = new ReviewsService(
    { manager: { transaction } } as never,
    {} as never,
    {} as never,
    authorization,
  );
  const context = authorization.createAuthenticatedContext({
    id: OWNER,
    email: "test@example.com",
    fullName: "Test",
    isAdmin: false,
  });

  await expect(
    service.update(REVIEW, { rating: 3, comment: "same" }, context),
  ).resolves.toMatchObject({
    ...review,
    isEdited: true,
    editedAt: new Date("2026-10-05T00:00:00Z"),
  });
  expect(reviewRepository.save).not.toHaveBeenCalled();
  expect(historyRepository.create).not.toHaveBeenCalled();
  expect(historyRepository.save).not.toHaveBeenCalled();
});

it("serializes concurrent updates and assigns distinct sequential revisions", async () => {
  const authorization = new AuthorizationService(new CaslAbilityFactory());
  const state = {
    rating: 3,
    comment: "original",
    histories: [] as Array<Record<string, unknown>>,
  };
  let locked = false;
  const waiting: Array<() => void> = [];
  const acquire = async () => {
    if (locked) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    locked = true;
  };
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else locked = false;
  };
  const reviewRepository = {
    createQueryBuilder: jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      setLock: jest.fn().mockReturnThis(),
      withDeleted: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({
        id: REVIEW,
        reviewerId: OWNER,
        postId: POST,
        get rating() {
          return state.rating;
        },
        set rating(value: number) {
          state.rating = value;
        },
        get comment() {
          return state.comment;
        },
        set comment(value: string | null) {
          state.comment = value ?? "";
        },
        deletedAt: null,
      }),
    })),
    save: jest.fn().mockImplementation((review) => review),
  };
  const historyRepository = {
    findOne: jest.fn().mockImplementation(async () => {
      const latest = state.histories.at(-1);
      return latest ?? null;
    }),
    find: jest
      .fn()
      .mockImplementation(async () => [...state.histories].reverse()),
    create: jest.fn().mockImplementation((value) => value),
    save: jest.fn().mockImplementation(async (history) => {
      const saved = {
        ...history,
        editedAt: new Date(),
      };
      state.histories.push(saved);
      return saved;
    }),
  };
  const manager = {
    getRepository: jest.fn((entity) =>
      entity === ReviewEntity ? reviewRepository : historyRepository,
    ),
  };
  const transaction = jest
    .fn()
    .mockImplementation(
      async (callback: (value: typeof manager) => unknown) => {
        await acquire();
        try {
          return await callback(manager);
        } finally {
          release();
        }
      },
    );
  const service = new ReviewsService(
    { manager: { transaction } } as never,
    {} as never,
    {} as never,
    authorization,
  );
  const context = authorization.createAuthenticatedContext({
    id: OWNER,
    email: "test@example.com",
    fullName: "Test",
    isAdmin: false,
  });

  const results = await Promise.all([
    service.update(REVIEW, { rating: 4 }, context),
    service.update(REVIEW, { rating: 5 }, context),
  ]);

  expect(state.histories.map((history) => history.revision)).toEqual([1, 2]);
  expect(new Set(state.histories.map((history) => history.revision)).size).toBe(
    2,
  );
  expect(results.map((result) => result.isEdited)).toEqual([true, true]);
});
