import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import {
  NotificationEntity,
  NotificationType,
} from "../notifications/notification.entity";
import { NotificationsService } from "../notifications/notifications.service";
import { DAY_MS, POST_REMINDER_DAYS } from "./post-lifecycle.constants";
import { PostEntity, PostStatus } from "./post.entity";

@Injectable()
export class PostExpiryService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly notifications: NotificationsService,
  ) {}

  /** Bounded batches; SKIP LOCKED allows multiple application instances. */
  async processBatch() {
    const result = await this.dataSource.transaction(async (manager) => {
      const posts = await manager
        .getRepository(PostEntity)
        .createQueryBuilder("post")
        .where("post.deleted_at IS NULL")
        .andWhere("post.status IN (:...statuses)", {
          statuses: [PostStatus.ACTIVE, PostStatus.EXPIRED],
        })
        .andWhere(
          `(
          (post.expires_at <= statement_timestamp() AND
            (post.status = 'active' OR NOT EXISTS (
              SELECT 1 FROM notifications n WHERE n.dedup_key = 'post:' || post.id::text || ':cycle:' || post.renewal_count::text || ':expired'
            )))
          OR (post.status = 'active' AND post.expires_at > statement_timestamp()
            AND post.expires_at <= statement_timestamp() + (:reminderDays * interval '1 day')
            AND NOT EXISTS (
              SELECT 1 FROM notifications n WHERE n.dedup_key = 'post:' || post.id::text || ':cycle:' || post.renewal_count::text || ':expiring'
            ))
        )`,
          { reminderDays: POST_REMINDER_DAYS },
        )
        .orderBy("post.expiresAt", "ASC")
        .addOrderBy("post.id", "ASC")
        .take(100)
        .setLock("pessimistic_write")
        .setOnLocked("skip_locked")
        .getMany();
      const [clock] = await manager.query("SELECT clock_timestamp() AS now");
      const now = new Date(clock.now);
      const created: NotificationEntity[] = [];
      let expired = 0;
      for (const post of posts) {
        const isExpired = post.expiresAt <= now;
        if (isExpired && post.status === PostStatus.ACTIVE) {
          await manager.update(PostEntity, post.id, {
            status: PostStatus.EXPIRED,
          });
          expired += 1;
        }
        // Do not send a stale warning if a batch crossed the expiration boundary.
        if (
          !isExpired &&
          post.expiresAt.getTime() > now.getTime() + POST_REMINDER_DAYS * DAY_MS
        )
          continue;
        const notification = await this.notifications.createOnce(manager, {
          userId: post.sellerId,
          type: isExpired
            ? NotificationType.POST_EXPIRED
            : NotificationType.POST_EXPIRING,
          refId: post.id,
          targetType: "my_post",
          dedupKey: `post:${post.id}:cycle:${post.renewalCount}:${isExpired ? "expired" : "expiring"}`,
          title: isExpired ? "Tin đăng đã hết hạn" : "Tin đăng sắp hết hạn",
          body: isExpired
            ? `Tin “${post.title}” đã hết hạn. Bạn có thể gia hạn trong Bài của tôi.`
            : `Tin “${post.title}” sẽ hết hạn vào ${post.expiresAt.toISOString()}.`,
        });
        if (notification) created.push(notification);
      }
      return { processed: posts.length, expired, created };
    });
    for (const notification of result.created)
      this.notifications.emitCreated(notification);
    return {
      processed: result.processed,
      expired: result.expired,
      notified: result.created.length,
    };
  }
}
