import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { PostsModule } from "../posts/posts.module";
import { AuthorizationModule } from "../authorization/authorization.module";
import { FavoriteEntity } from "./favorite.entity";
import { FavoritesController } from "./favorites.controller";
import { FavoritesService } from "./favorites.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([FavoriteEntity]),
    PostsModule,
    AuthorizationModule,
  ],
  controllers: [FavoritesController],
  providers: [FavoritesService],
})
export class FavoritesModule {}
