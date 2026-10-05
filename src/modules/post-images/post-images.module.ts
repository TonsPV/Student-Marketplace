import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PostEntity } from '../posts/post.entity';
import { PostImageEntity } from './post-image.entity';
import { PostImagesController } from './post-images.controller';
import { PostImagesService } from './post-images.service';

@Module({
  imports: [TypeOrmModule.forFeature([PostImageEntity, PostEntity])],
  controllers: [PostImagesController],
  providers: [PostImagesService],
})
export class PostImagesModule {}
