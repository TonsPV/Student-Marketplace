import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { PostsModule } from "../posts/posts.module";
import { AuthorizationModule } from "../authorization/authorization.module";
import { PostImageEntity } from "./post-image.entity";
import { PostImagesController } from "./post-images.controller";
import { PostImagesService } from "./post-images.service";
import { StorageModule } from "../storage/storage.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([PostImageEntity]),
    PostsModule,
    AuthorizationModule,
    StorageModule,
  ],
  controllers: [PostImagesController],
  providers: [PostImagesService],
})
export class PostImagesModule {}
