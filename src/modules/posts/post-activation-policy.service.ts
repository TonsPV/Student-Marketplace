import { Inject, Injectable, Optional } from "@nestjs/common";
import { EntityManager } from "typeorm";
import { POST_QUOTA } from "./post-lifecycle.constants";

export interface PostingDecision {
  allowed: boolean;
  reason: string | null;
  blockedUntil: Date | null;
  /** Effective quota can be reduced by reputation, never increased above 5. */
  limit: number;
}

export interface PostingRestrictionPolicy {
  // Called after locking the seller row, inside the activation transaction.
  evaluate(manager: EntityManager, sellerId: string): Promise<PostingDecision>;
}

export const POSTING_RESTRICTION_POLICY = Symbol("POSTING_RESTRICTION_POLICY");

@Injectable()
export class PostActivationPolicyService {
  constructor(
    @Optional()
    @Inject(POSTING_RESTRICTION_POLICY)
    private readonly restrictions?: PostingRestrictionPolicy,
  ) {}

  async evaluate(
    manager: EntityManager,
    sellerId: string,
  ): Promise<PostingDecision> {
    // Reputation restrictions will be connected by Tấn through the token above.
    if (!this.restrictions) {
      return {
        allowed: true,
        reason: null,
        blockedUntil: null,
        limit: POST_QUOTA,
      };
    }
    const decision = await this.restrictions.evaluate(manager, sellerId);
    if (
      !Number.isInteger(decision.limit) ||
      decision.limit < 0 ||
      decision.limit > POST_QUOTA
    ) {
      throw new Error("Posting policy returned an invalid quota");
    }
    return decision;
  }
}
