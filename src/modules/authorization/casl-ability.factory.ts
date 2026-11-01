import { Injectable } from "@nestjs/common";
import { AbilityBuilder, createMongoAbility } from "@casl/ability";
import type { AppAbility, AuthenticatedPrincipal } from "./authorization.types";
import { definePostRules } from "./policies/post.policy";
import { defineCategoryRules } from "./policies/category.policy";
import { defineUserRules } from "./policies/user.policy";
import { defineReportRules } from "./policies/report.policy";
import { defineReviewRules } from "./policies/review.policy";
import { defineConversationRules } from "./policies/conversation.policy";
import { definePersonalResourceRules } from "./policies/personal-resource.policy";
import { defineModerationRules } from "./policies/moderation.policy";
import { definePostPromotionRules } from "./policies/post-promotion.policy";

@Injectable()
export class CaslAbilityFactory {
  createForActor(actor: AuthenticatedPrincipal | null): AppAbility {
    const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);
    definePostRules(can, actor);
    defineCategoryRules(can, actor);
    defineUserRules(can, actor);
    defineReportRules(can, actor);
    defineReviewRules(can, actor);
    defineConversationRules(can, actor);
    definePersonalResourceRules(can, actor);
    defineModerationRules(can, actor);
    definePostPromotionRules(can, actor);
    return build();
  }
}
