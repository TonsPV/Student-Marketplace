import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiTags } from "@nestjs/swagger";

import { ParseUUIDPipe } from "@nestjs/common";

import {
  GetUser,
  Public,
  ResponseMessage,
} from "../../common/decorators/customize.decorator";
import { UserInterface } from "../../shared/interfaces/user.interface";
import { CreatePostDto } from "./dto/create-post.dto";
import { FindPostsDto } from "./dto/find-posts.dto";
import { UpdatePostDto } from "./dto/update-post.dto";
import { PostsService } from "./posts.service";

@ApiTags("posts")
@Controller("posts")
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  // Tạo bài viết
  @Post()
  @ApiBearerAuth("access-token")
  @ApiBody({ type: CreatePostDto })
  @ResponseMessage("Post created successfully!")
  create(@Body() dto: CreatePostDto, @GetUser() user: UserInterface) {
    return this.postsService.create(dto, user.id);
  }

  // Lấy danh sách bài viết
  @Get()
  @Public()
  @ResponseMessage("Posts retrieved successfully!")
  findAll(@Query() query: FindPostsDto) {
    return this.postsService.findAll(query);
  }

  // Lấy chi tiết bài viết
  @Get("me")
  @ApiBearerAuth("access-token")
  @ResponseMessage("My posts retrieved successfully!")
  findMyPosts(@GetUser() user: UserInterface, @Query() query: FindPostsDto) {
    return this.postsService.findMyPosts(user.id, query);
  }

  @Get(":id")
  @Public()
  @ResponseMessage("Post retrieved successfully!")
  findOne(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.postsService.findOne(id);
  }

  // Cập nhật bài viết
  @Patch(":id")
  @ApiBearerAuth("access-token")
  @ApiBody({ type: UpdatePostDto })
  @ResponseMessage("Post updated successfully!")
  update(
    @Param("id") id: string,
    @Body() dto: UpdatePostDto,
    @GetUser() user: UserInterface,
  ) {
    return this.postsService.update(id, dto, user.id);
  }

  // Đánh dấu đã bán
  @Patch(":id/sold")
  @ApiBearerAuth("access-token")
  @ResponseMessage("Post marked as sold successfully!")
  markAsSold(@Param("id") id: string, @GetUser() user: UserInterface) {
    return this.postsService.markAsSold(id, user.id);
  }

  // Xóa mềm bài viết
  @Delete(":id")
  @ApiBearerAuth("access-token")
  @ResponseMessage("Post deleted successfully!")
  remove(@Param("id") id: string, @GetUser() user: UserInterface) {
    return this.postsService.remove(id, user.id);
  }

  @Patch(":id/restore")
  @ApiBearerAuth("access-token")
  @ResponseMessage("Post restored successfully!")
  restore(@Param("id", new ParseUUIDPipe()) id: string, @GetUser() user: UserInterface) {
    return this.postsService.restore(id, user.id);
  }
}
