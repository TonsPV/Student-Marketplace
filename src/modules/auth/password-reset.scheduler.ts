import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { PasswordResetService } from "./services/password-reset.service";

@Injectable()
export class PasswordResetScheduler {
  private readonly logger = new Logger(PasswordResetScheduler.name);
  constructor(private readonly resets: PasswordResetService) {}

  @Cron("0 2 * * *", {
    name: "password-reset-cleanup",
    timeZone: "Asia/Ho_Chi_Minh",
    waitForCompletion: true,
  })
  async cleanup(): Promise<void> {
    try {
      const { count } = await this.resets.cleanupExpiredChallenges();
      if (count)
        this.logger.log(`Removed ${count} expired password reset challenges`);
    } catch {
      this.logger.error("Password reset challenge cleanup failed");
    }
  }
}
