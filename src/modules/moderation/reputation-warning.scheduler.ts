import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { DataSource } from "typeorm";
import { UserEntity } from "../user/user.entity";
import { ReviewEntity } from "../reviews/review.entity";
import { PostEntity, PostStatus } from "../posts/post.entity";
import { NotificationsService } from "../notifications/notifications.service";
import { NotificationType } from "../notifications/notification.entity";
import { sellerPostingReputation } from "./reputation-posting-policy";

@Injectable()
export class ReputationWarningScheduler {
  private running = false;
  private readonly logger = new Logger(ReputationWarningScheduler.name);
  constructor(
    private readonly db: DataSource,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron("0 */5 * * * *")
  async run() {
    if (this.running) return;
    this.running = true;
    try {
      let cursor = "00000000-0000-0000-0000-000000000000";
      for (;;) {
        const candidates = await this.db
          .getRepository(ReviewEntity)
          .createQueryBuilder("review")
          .withDeleted()
          .innerJoin(PostEntity, "post", "post.id = review.postId")
          .innerJoin(
            UserEntity,
            "seller",
            "seller.id = post.sellerId AND seller.isLocked = false AND seller.deletedAt IS NULL",
          )
          .where("review.deletedAt IS NULL")
          .andWhere("post.status IN (:...statuses)", {
            statuses: [PostStatus.ACTIVE, PostStatus.SOLD],
          })
          .andWhere("seller.id > :cursor", { cursor })
          .select("seller.id", "id")
          .groupBy("seller.id")
          .having(
            "COUNT(review.id) >= 3 AND SUM(review.rating) < 2 * COUNT(review.id)",
          )
          .orderBy("seller.id", "ASC")
          .limit(100)
          .getRawMany<{ id: string }>();
        if (!candidates.length) break;
        for (const { id } of candidates) {
          const notification = await this.db.transaction(async (manager) => {
            const user = await manager
              .getRepository(UserEntity)
              .createQueryBuilder("seller")
              .where("seller.id = :id AND seller.isLocked = false", { id })
              .setLock("for_no_key_update")
              .getOne();
            if (!user) return null;
            const state = await sellerPostingReputation(manager, id);
            if (!state.warning) return null;
            // One automatic notice per seller; live status always reflects
            // recovery/restriction. Replicas and later runs cannot spam notices.
            return this.notifications.createOnce(manager, {
              userId: id,
              type: NotificationType.MODERATION_WARNING,
              refId: id,
              targetType: "posting_status",
              dedupKey: `reputation-warning:${id}`,
              title: "Cảnh báo điểm uy tín",
              body: state.reason!,
            });
          });
          if (notification) this.notifications.emitCreated(notification);
        }
        cursor = candidates[candidates.length - 1].id;
      }
    } catch (error) {
      this.logger.error(
        "Reputation warning delivery failed",
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    } finally {
      this.running = false;
    }
  }
}
