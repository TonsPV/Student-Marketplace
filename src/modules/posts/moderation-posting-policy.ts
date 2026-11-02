import { Injectable, ForbiddenException } from "@nestjs/common";
import { sellerPostingReputation } from "../moderation/reputation-posting-policy";
import { EntityManager } from "typeorm";
import { ModerationService } from "../moderation/moderation.service";
import {
  mostSevereRestriction,
  postingRestrictedException,
} from "../moderation/posting-restriction.rules";
import {
  PostingRestrictionPolicy,
  PostingDecision,
} from "./post-activation-policy.service";
import { POST_QUOTA } from "./post-lifecycle.constants";
@Injectable()
export class ModerationPostingPolicy implements PostingRestrictionPolicy {
  constructor(private readonly moderation: ModerationService) {}
  async evaluate(
    manager: EntityManager,
    sellerId: string,
  ): Promise<PostingDecision> {
    const [clock] = await manager.query("SELECT clock_timestamp() AS now");
    const restriction = mostSevereRestriction(
      await this.moderation.getActivePostingRestrictions(sellerId, {
        manager,
        now: new Date(clock.now),
      }),
    );
    const reputation = await sellerPostingReputation(manager, sellerId);
    return {
      allowed: !restriction && !reputation.blocked,
      reason: restriction?.reason ?? reputation.reason,
      blockedUntil: restriction?.expiresAt ?? null,
      limit: POST_QUOTA,
      ...(restriction
        ? { denial: postingRestrictedException(restriction) }
        : reputation.blocked
          ? {
              denial: new ForbiddenException({
                statusCode: 403,
                code: "REPUTATION_POSTING_RESTRICTED",
                message: reputation.reason,
              }),
            }
          : {}),
    };
  }
}
