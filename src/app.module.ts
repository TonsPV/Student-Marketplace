import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule, TypeOrmModuleOptions } from "@nestjs/typeorm";
import { FavoritesModule } from "./modules/favorites/favorites.module";
import { AppController } from "./app.controller";
import { UserModule } from "./modules/user/user.module";
import { AuthModule } from "./modules/auth/auth.module";
import { CategoryModule } from "./modules/categories/category.module";
import { AppService } from "./app.service";
import { PostsModule } from './modules/posts/posts.module';
import { PostImagesModule } from './modules/post-images/post-images.module';
import { ReportsModule } from './modules/reports/reports.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { RealtimeModule } from "./modules/realtime/realtime.module";
import { ReviewsModule } from "./modules/reviews/reviews.module";

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
        type: "postgres",
        host: config.getOrThrow<string>("POSTGRES_HOST"),
        port: config.getOrThrow<number>("POSTGRES_PORT"),
        username: config.getOrThrow<string>("POSTGRES_USER"),
        password: config.getOrThrow<string>("POSTGRES_PASSWORD"),
        database: config.getOrThrow<string>("POSTGRES_DB"),
        autoLoadEntities: true,
        // Local development only; migration strategy will be decided later.
        synchronize: true,
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
    RealtimeModule,
    ReviewsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
