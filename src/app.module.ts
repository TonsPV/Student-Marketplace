import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule, TypeOrmModuleOptions } from "@nestjs/typeorm";
import { FavoritesModule } from "./modules/favorites/favorites.module";
import { AppController } from "./app.controller";
import { UserModule } from "./modules/user/user.module";
import { AuthModule } from "./modules/auth/auth.module";
import { CategoryModule } from "./modules/categories/category.module";
import { AppService } from "./app.service";
import { PostsModule } from "./modules/posts/posts.module";
import { PostImagesModule } from "./modules/post-images/post-images.module";
import { ReportsModule } from "./modules/reports/reports.module";
import { ConversationsModule } from "./modules/conversations/conversations.module";
import { MessagesModule } from "./modules/messages/messages.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { StorageModule } from "./modules/storage/storage.module";
import { RealtimeModule } from "./modules/realtime/realtime.module";
import { databaseOptions } from "./config/database.config";
import { ReviewsModule } from "./modules/reviews/reviews.module";
import { AuthorizationModule } from "./modules/authorization/authorization.module";
import { AuthPrincipalModule } from "./common/auth-principal/auth-principal.module";
import { SessionRegistryModule } from "./common/session-registry/session-registry.module";
import { AccountLifecycleModule } from "./common/account-lifecycle/account-lifecycle.module";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { PoliciesGuard } from "./modules/authorization/guards/policies.guard";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService): TypeOrmModuleOptions => ({
        ...databaseOptions(
          Object.fromEntries(
            [
              "POSTGRES_HOST",
              "POSTGRES_PORT",
              "POSTGRES_USER",
              "POSTGRES_PASSWORD",
              "POSTGRES_DB",
              "POSTGRES_SCHEMA",
              "POSTGRES_SYNCHRONIZE",
              "NODE_ENV",
            ].map((key) => [
              key,
              [
                "POSTGRES_HOST",
                "POSTGRES_PORT",
                "POSTGRES_USER",
                "POSTGRES_PASSWORD",
                "POSTGRES_DB",
              ].includes(key)
                ? config.getOrThrow<string>(key)
                : config.get<string>(key),
            ]),
          ),
        ),
        autoLoadEntities: true,
      }),
    }),
    AuthModule,
    UserModule,
    PostsModule,
    FavoritesModule,
    PostImagesModule,
    CategoryModule,
    ReportsModule,
    ConversationsModule,
    MessagesModule,
    NotificationsModule,
    StorageModule,
    RealtimeModule,
    ReviewsModule,
    AuthorizationModule,
    AuthPrincipalModule,
    SessionRegistryModule,
    AccountLifecycleModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PoliciesGuard },
  ],
})
export class AppModule {}
