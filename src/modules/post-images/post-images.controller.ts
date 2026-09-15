import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiTags } from '@nestjs/swagger';
import { GetUser, Public, ResponseMessage } from '../../common/decorators/customize.decorator';
import { UserInterface } from '../../shared/interfaces/user.interface';
import { CreatePostImageDto } from './dto/create-post-image.dto';
import { PostImagesService } from './post-images.service';

@ApiTags('post-images')
@Controller('posts/:postId/images')
export class PostImagesController {
  constructor(private readonly postImagesService: PostImagesService) {}

  @Post()
  @ApiBearerAuth('access-token')
  @ApiBody({ type: CreatePostImageDto })
  @ResponseMessage('Post image created successfully!')
  create(
    @Param('postId', new ParseUUIDPipe()) postId: string,
    @Body() dto: CreatePostImageDto,
    @GetUser() user: UserInterface,
  ) {
    return this.postImagesService.create(postId, dto, user.id);
  }

  @Get()
  @Public()
  @ResponseMessage('Post images retrieved successfully!')
  findAll(@Param('postId', new ParseUUIDPipe()) postId: string) {
    return this.postImagesService.findAll(postId);
  }

  @Delete(':imageId')
  @ApiBearerAuth('access-token')
  @ResponseMessage('Post image deleted successfully!')
  remove(
    @Param('postId', new ParseUUIDPipe()) postId: string,
    @Param('imageId', new ParseUUIDPipe()) imageId: string,
    @GetUser() user: UserInterface,
  ) {
    return this.postImagesService.remove(postId, imageId, user.id);
  }
}
