/**
 * F2-09 regression — Realtime emit failure after the sale transaction.
 *
 * Root cause (audit): markAsSold() emits WS_EVENTS.NOTIFICATION_NEW after the
 * database transaction has committed. emitToUser() is a synchronous void call
 * that can throw (gateway not bound, session registry failure), and the call
 * site is not isolated, so a committed sale could be reported as a failed
 * request to the seller.
 *
 * R1 is the detector: against the pre-fix code it FAILS because markAsSold
 * rejects with the realtime error even though the transaction committed.
 * After the fix R1 must PASS. Do not weaken these assertions to force a
 * green suite.
 */
import { DataSource, Repository } from "typeorm";
import { PostsService } from "../../src/modules/posts/posts.service";
import { PostEntity, PostStatus } from "../../src/modules/posts/post.entity";
import { CategoryEntity } from "../../src/modules/categories/category.entity";
import { AuthorizationService } from "../../src/modules/authorization/authorization.service";
import { ConversationEntity } from "../../src/modules/conversations/entities/conversation.entity";
import { MessageEntity } from "../../src/modules/messages/entities/message.entity";
import { ReviewEntity } from "../../src/modules/reviews/review.entity";
import {
  NotificationEntity,
  NotificationType,
} from "../../src/modules/notifications/notification.entity";
import { StorageService } from "../../src/modules/storage/storage.service";
import { ModerationService } from "../../src/modules/moderation/moderation.service";
import { RealtimeService } from "../../src/modules/realtime/realtime.service";
import { WS_EVENTS } from "../../src/modules/realtime/realtime.events";

const POST = "11111111-1111-4111-8111-111111111111";
const SELLER = "22222222-2222-4222-8222-222222222222";
const BUYER = "33333333-3333-4333-8333-333333333333";

type MarkAsSoldContext = Parameters<PostsService["markAsSold"]>[2];

interface Harness {
  service: PostsService;
  post: PostEntity;
  emitToUser: jest.Mock;
  txPostSave: jest.Mock;
  transaction: jest.Mock;
}

function createHarness(options: {
  emitImpl: () => void;
  conversation: unknown;
}): Harness {
  const post = Object.assign(new PostEntity(), {
    id: POST,
    sellerId: SELLER,
    status: PostStatus.ACTIVE,
    deletedAt: null,
  });

  const txPostSave = jest.fn(async (saved: PostEntity) => saved);
  const manager = {
    getRepository: (entity: unknown) => {
      if (entity === PostEntity) {
        const postQuery: Record<string, jest.Mock> = {};
        for (const method of ["setLock", "where"])
          postQuery[method] = jest.fn().mockReturnValue(postQuery);
        postQuery.getOne = jest.fn().mockResolvedValue(post);
        return {
          findOne: jest.fn().mockResolvedValue(post),
          save: txPostSave,
          createQueryBuilder: jest.fn(() => postQuery),
        };
      }
      if (entity === ConversationEntity) {
        return {
          createQueryBuilder: () => ({
            innerJoin: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            andWhere: jest.fn().mockReturnThis(),
            getOne: jest.fn().mockResolvedValue(options.conversation),
          }),
        };
      }
      if (entity === NotificationEntity) {
        return {
          findOneBy: jest.fn().mockResolvedValue(null),
          create: jest.fn((input: unknown) => input),
          save: jest.fn(async (input: unknown) => input),
        };
      }
      return {};
    },
  };
  const transaction = jest.fn(
    async (callback: (m: unknown) => Promise<unknown>) => callback(manager),
  );
  const emitToUser = jest.fn(options.emitImpl);

  const service = new PostsService(
    {} as unknown as Repository<PostEntity>,
    {} as unknown as Repository<CategoryEntity>,
    {
      assertResource: jest.fn(),
      assertRoute: jest.fn(),
    } as unknown as AuthorizationService,
    { transaction } as unknown as DataSource,
    {} as unknown as StorageService,
    {} as unknown as ModerationService,
    {} as unknown as Repository<ConversationEntity>,
    {} as unknown as Repository<MessageEntity>,
    {} as unknown as Repository<ReviewEntity>,
    { emitToUser } as unknown as RealtimeService,
  );

  return { service, post, emitToUser, txPostSave, transaction };
}

describe("PostsService.markAsSold — realtime failure after commit (F2-09)", () => {
  const context = {
    principal: { id: SELLER },
  } as unknown as MarkAsSoldContext;

  it("R1 detector: realtime emit failure must not fail the committed sale", async () => {
    const harness = createHarness({
      emitImpl: () => {
        throw new Error("websocket gateway unavailable");
      },
      conversation: { id: "conversation-1" },
    });

    // Before the fix this call rejects with "websocket gateway unavailable"
    // even though the transaction already committed the sale.
    const result = await harness.service.markAsSold(
      POST,
      { buyerId: BUYER },
      context,
    );

    expect(result).toBeTruthy();
    expect(harness.post.status).toBe(PostStatus.SOLD);
    expect(harness.txPostSave).toHaveBeenCalledTimes(1);
    expect(harness.emitToUser).toHaveBeenCalledTimes(1);
  });

  it("R2: a healthy emit publishes the review-request event exactly once", async () => {
    const harness = createHarness({
      emitImpl: () => undefined,
      conversation: { id: "conversation-1" },
    });

    await harness.service.markAsSold(POST, { buyerId: BUYER }, context);

    expect(harness.emitToUser).toHaveBeenCalledTimes(1);
    expect(harness.emitToUser).toHaveBeenCalledWith(
      BUYER,
      WS_EVENTS.NOTIFICATION_NEW,
      {
        type: NotificationType.REVIEW_REQUEST,
        refId: POST,
      },
    );
  });

  it("R3: business failure inside the transaction is not masked and emit is skipped", async () => {
    const harness = createHarness({
      emitImpl: () => undefined,
      conversation: null,
    });

    await expect(
      harness.service.markAsSold(POST, { buyerId: BUYER }, context),
    ).rejects.toThrow("Buyer has not contacted this post");
    expect(harness.emitToUser).not.toHaveBeenCalled();
  });
});
