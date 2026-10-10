import { Module } from "@nestjs/common";
import { AuthService } from "./services/auth.service";
import { AuthController } from "./auth.controller";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { StringValue } from "ms";
import { RefreshTokenModule } from "../refresh-token/refresh-token.module";
import { UserModule } from "../user/user.module";
import { PassportModule } from "@nestjs/passport";
import { PasswordService } from "./services/password.service";
import { JwtStrategy } from "./strategies/jwt.strategy";
import { GoogleStrategy } from "./strategies/google.strategy";
import googleOauthConfig from "../../config/google-oauth.config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { UserEntity } from "../user/user.entity";
import { AuthPrincipalModule } from "../../common/auth-principal/auth-principal.module";
import { AuthorizationModule } from "../authorization/authorization.module";
import { MailModule } from "../mailer/mail.module";
import { ThrottlerModule } from "@nestjs/throttler";
import { PasswordResetChallengeEntity } from "./password-reset-challenge.entity";
import { PasswordResetService } from "./services/password-reset.service";
import { PasswordResetController } from "./password-reset.controller";
import { PasswordResetScheduler } from "./password-reset.scheduler";

@Module({
  imports: [
    RefreshTokenModule,
    UserModule,
    TypeOrmModule.forFeature([UserEntity, PasswordResetChallengeEntity]),
    MailModule,
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 10 }]),
    PassportModule,
    ConfigModule.forFeature(googleOauthConfig),
    AuthPrincipalModule,
    AuthorizationModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>("JWT_ACCESS_SECRET"),
        signOptions: {
          expiresIn: configService.get<string>(
            "JWT_ACCESS_EXPIRED",
          ) as StringValue,
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController, PasswordResetController],
  providers: [
    AuthService,
    PasswordService,
    JwtStrategy,
    GoogleStrategy,
    PasswordResetService,
    PasswordResetScheduler,
  ],
})
export class AuthModule {}
