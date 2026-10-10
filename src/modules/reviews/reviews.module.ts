import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { PostEntity } from "../posts/post.entity";
import { UserEntity } from "../user/user.entity";
import { ReviewEntity } from "./review.entity";
import { ReviewsController } from "./reviews.controller";
import { ReviewsService } from "./reviews.service";
import { AuthorizationModule } from "../authorization/authorization.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([ReviewEntity, PostEntity, UserEntity]),
    AuthorizationModule,
  ],
  controllers: [ReviewsController],
  providers: [ReviewsService],
  exports: [ReviewsService],
})
export class ReviewsModule {}
