import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RefreshTokenService } from './refresh-token.service';


@Injectable()
export class RefreshTokenScheduler {
  private readonly logger = new Logger(RefreshTokenScheduler.name);

  constructor(private readonly refreshTokenService: RefreshTokenService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async cleanupInactiveRefreshTokens() {
    const result = await this.refreshTokenService.cleanupInactiveRefreshTokens();

    if (result.count > 0) {
      this.logger.log(`Cleaned up ${result.count} inactive refresh token(s)`);
    }
  }
}
