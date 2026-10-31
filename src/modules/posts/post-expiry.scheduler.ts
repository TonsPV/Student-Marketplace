import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { PostExpiryService } from "./post-expiry.service";

@Injectable()
export class PostExpiryScheduler {
  private readonly logger = new Logger(PostExpiryScheduler.name);
  constructor(private readonly expiry: PostExpiryService) {}

  @Cron("* * * * *", { name: "post-expiry", waitForCompletion: true })
  async run() {
    try {
      await this.expiry.processBatch();
    } catch (error) {
      this.logger.error(
        `Post expiry job failed: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}
