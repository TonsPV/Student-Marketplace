import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CategoryEntity } from "../categories/category.entity";
import { PostEntity } from "./post.entity";
import { PostsController } from "./posts.controller";
import { PostsService } from "./posts.service";
import { AuthorizationModule } from "../authorization/authorization.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([PostEntity, CategoryEntity]),
    AuthorizationModule,
  ],
  controllers: [PostsController],
  providers: [PostsService],
  exports: [PostsService],
})
export class PostsModule {}
