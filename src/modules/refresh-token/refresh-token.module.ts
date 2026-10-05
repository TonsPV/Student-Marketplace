import { Module } from '@nestjs/common';

import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { RefreshTokenScheduler } from './refresh-token.scheduler';
import { RefreshTokenController } from './refresh-token.controller';
import { RefreshTokenService } from './refresh-token.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RefreshTokenEntity } from './refresh-token.entity';


@Module({
  imports: [
    TypeOrmModule.forFeature([RefreshTokenEntity]),
    ConfigModule,
    JwtModule.register({}),
    ScheduleModule.forRoot(),
  ],
  controllers: [RefreshTokenController],
  providers: [RefreshTokenService, RefreshTokenScheduler],
  exports: [RefreshTokenService],
})
export class RefreshTokenModule {}
