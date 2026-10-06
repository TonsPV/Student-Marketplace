import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { PostEntity } from "../posts/post.entity";
import { UserEntity } from "../user/user.entity";
import { ReviewEntity } from "./review.entity";
import { ReviewsController } from "./reviews.controller";
import { ReviewsService } from "./reviews.service";

@Module({
  imports: [TypeOrmModule.forFeature([ReviewEntity, PostEntity, UserEntity])],
  controllers: [ReviewsController],
  providers: [ReviewsService],
})
export class ReviewsModule {}
