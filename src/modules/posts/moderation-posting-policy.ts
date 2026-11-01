import { Injectable } from "@nestjs/common";
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
    return {
      allowed: !restriction,
      reason: restriction?.reason ?? null,
      blockedUntil: restriction?.expiresAt ?? null,
      limit: POST_QUOTA,
      ...(restriction
        ? { denial: postingRestrictedException(restriction) }
        : {}),
    };
  }
}
