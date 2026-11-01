import { ReviewsService } from "../../src/modules/reviews/reviews.service";
import { AuthorizationService } from "../../src/modules/authorization/authorization.service";
import { CaslAbilityFactory } from "../../src/modules/authorization/casl-ability.factory";
const REVIEW = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  OWNER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  POST = "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  OTHER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
it("empty/undefined review patches are rejected after instance authorization, before save", async () => {
  const authorization = new AuthorizationService(new CaslAbilityFactory()),
    save = jest.fn();
  const service = new ReviewsService(
    {
      findOneBy: jest
        .fn()
        .mockResolvedValue({ id: REVIEW, reviewerId: OWNER, postId: POST }),
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
    findOneBy = jest.fn().mockResolvedValue({
      id: REVIEW,
      reviewerId: OWNER,
      postId: POST,
      deletedAt: new Date(),
    }),
    save = jest.fn(),
    softRemove = jest.fn();
  const service = new ReviewsService(
    { findOneBy, save, softRemove } as never,
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
