/**
 * MODULE: REVIEWS (ĐÁNH GIÁ NGƯỜI BÁN)
 *
 * WORD TEST CASES:
 * - TC-RHIS-01: Reviewer đọc được lịch sử sau khi review bị soft-delete
 * - TC-RHIS-02: Admin đọc được lịch sử sau khi review bị soft-delete
 * - TC-RHIS-03: User khác và guest không đọc được lịch sử review
 * - TC-RHIS-04: Review đã soft-delete vẫn bị ẩn khỏi API đọc chi tiết công khai
 */

import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { ReviewsService } from "../../src/modules/reviews/reviews.service";
import { ReviewEditHistoryEntity } from "../../src/modules/reviews/review-edit-history.entity";
import { AuthorizationService } from "../../src/modules/authorization/authorization.service";
import { CaslAbilityFactory } from "../../src/modules/authorization/casl-ability.factory";

const REVIEW = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function serviceWithDeletedReview() {
  const authorization = new AuthorizationService(new CaslAbilityFactory());
  const historyRepository = {
    find: jest.fn().mockResolvedValue([
      {
        id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        reviewId: REVIEW,
        editorId: OWNER,
        oldRating: 3,
        newRating: 4,
        oldComment: "old",
        newComment: "new",
        revision: 1,
        editedAt: new Date("2026-10-05T00:00:00Z"),
      },
    ]),
  };
  const service = new ReviewsService(
    {
      manager: {
        getRepository: jest.fn((entity) =>
          entity === ReviewEditHistoryEntity ? historyRepository : {},
        ),
      },
      createQueryBuilder: jest.fn(() => ({
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      })),
      findOne: jest.fn().mockResolvedValue({
        id: REVIEW,
        reviewerId: OWNER,
        deletedAt: new Date("2026-10-06T00:00:00Z"),
      }),
    } as never,
    {} as never,
    {} as never,
    authorization,
  );
  return { authorization, service, historyRepository };
}

// [WORD-TC: TC-RHIS-01]
// Chức năng: Reviewer đọc được lịch sử sau khi review bị soft-delete
test("[TC-RHIS-01] Reviewer đọc được lịch sử sau khi review bị soft-delete", async () => {
  const { authorization, service } = serviceWithDeletedReview();
  const context = authorization.createAuthenticatedContext({
    id: OWNER,
    email: "owner@example.com",
    fullName: "Owner",
    isAdmin: false,
  });

  await expect(service.findHistory(REVIEW, context)).resolves.toHaveLength(1);
});

// [WORD-TC: TC-RHIS-02]
// Chức năng: Admin đọc được lịch sử sau khi review bị soft-delete
test("[TC-RHIS-02] Admin đọc được lịch sử sau khi review bị soft-delete", async () => {
  const { authorization, service } = serviceWithDeletedReview();
  const context = authorization.createAuthenticatedContext({
    id: OTHER,
    email: "admin@example.com",
    fullName: "Admin",
    isAdmin: true,
  });

  await expect(service.findHistory(REVIEW, context)).resolves.toHaveLength(1);
});

// [WORD-TC: TC-RHIS-03]
// Chức năng: User khác và guest không đọc được lịch sử review
test("[TC-RHIS-03] User khác và guest không đọc được lịch sử review", async () => {
  const { authorization, service } = serviceWithDeletedReview();
  const other = authorization.createAuthenticatedContext({
    id: OTHER,
    email: "other@example.com",
    fullName: "Other",
    isAdmin: false,
  });
  const guest = authorization.createGuestContext();

  await expect(service.findHistory(REVIEW, other)).rejects.toBeInstanceOf(
    ForbiddenException,
  );
  await expect(
    service.findHistory(REVIEW, guest as never),
  ).rejects.toBeInstanceOf(ForbiddenException);
});

// [WORD-TC: TC-RHIS-04]
// Chức năng: Review đã soft-delete vẫn bị ẩn khỏi API đọc chi tiết công khai
test("[TC-RHIS-04] Review đã soft-delete vẫn bị ẩn khỏi API đọc chi tiết công khai", async () => {
  const { authorization, service } = serviceWithDeletedReview();

  await expect(
    service.findOne(REVIEW, authorization.createGuestContext()),
  ).rejects.toBeInstanceOf(NotFoundException);
});
