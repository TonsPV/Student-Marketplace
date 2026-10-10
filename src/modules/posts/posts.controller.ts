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
  Public,
  ResponseMessage,
} from "../../common/decorators/customize.decorator";
import { CheckPolicies } from "../authorization/decorators/check-policies.decorator";
import { GetAuthorizationContext } from "../authorization/decorators/get-authorization-context.decorator";
import type {
  AuthenticatedContext,
  AuthorizationContext,
} from "../authorization/authorization.types";
import { CreatePostDto } from "./dto/create-post.dto";
import { FindPostsDto } from "./dto/find-posts.dto";
import { SearchPostsDto } from "./dto/search-posts.dto";
import { UpdatePostDto } from "./dto/update-post.dto";
import { PostsService } from "./posts.service";

@ApiTags("posts")
@Controller("posts")
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @Post()
  @CheckPolicies({ action: "create", subject: "Post" })
  @ApiBearerAuth("access-token")
  @ApiBody({ type: CreatePostDto })
  @ResponseMessage("Post created successfully!")
  create(
    @Body() dto: CreatePostDto,
    @GetAuthorizationContext() ctx: AuthenticatedContext,
  ) {
    return this.postsService.create(dto, ctx);
  }

  @Get()
  @Public()
  @ResponseMessage("Posts retrieved successfully!")
  findAll(
    @Query() query: FindPostsDto,
    @GetAuthorizationContext() ctx: AuthorizationContext,
  ) {
    return this.postsService.findAll(query, ctx);
  }

  @Get("me")
  @CheckPolicies({ action: "read", subject: "Post" })
  @ApiBearerAuth("access-token")
  @ResponseMessage("My posts retrieved successfully!")
  findMyPosts(
    @GetAuthorizationContext() ctx: AuthenticatedContext,
    @Query() query: FindPostsDto,
  ) {
    return this.postsService.findMyPosts(ctx, query);
  }

  @Get("search")
  @Public()
  @ResponseMessage("Posts found successfully!")
  search(
    @Query() query: SearchPostsDto,
    @GetAuthorizationContext() ctx: AuthorizationContext,
  ) {
    return this.postsService.search(query, ctx);
  }

  @Get(":id")
  @Public()
  @ResponseMessage("Post retrieved successfully!")
  findOne(
    @Param("id", new ParseUUIDPipe()) id: string,
    @GetAuthorizationContext() ctx: AuthorizationContext,
  ) {
    return this.postsService.findOne(id, ctx);
  }

  @Patch(":id")
  @CheckPolicies({ action: "update", subject: "Post" })
  @ApiBearerAuth("access-token")
  @ApiBody({ type: UpdatePostDto })
  @ResponseMessage("Post updated successfully!")
  update(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: UpdatePostDto,
    @GetAuthorizationContext() ctx: AuthenticatedContext,
  ) {
    return this.postsService.update(id, dto, ctx);
  }

  @Patch(":id/sold")
  @CheckPolicies({ action: "markSold", subject: "Post" })
  @ApiBearerAuth("access-token")
  @ResponseMessage("Post marked as sold successfully!")
  markAsSold(
    @Param("id", new ParseUUIDPipe()) id: string,
    @GetAuthorizationContext() ctx: AuthenticatedContext,
  ) {
    return this.postsService.markAsSold(id, ctx);
  }

  @Delete(":id")
  @CheckPolicies({ action: "delete", subject: "Post" })
  @ApiBearerAuth("access-token")
  @ResponseMessage("Post deleted successfully!")
  remove(
    @Param("id", new ParseUUIDPipe()) id: string,
    @GetAuthorizationContext() ctx: AuthenticatedContext,
  ) {
    return this.postsService.remove(id, ctx);
  }

  @Patch(":id/restore")
  @CheckPolicies({ action: "restore", subject: "Post" })
  @ApiBearerAuth("access-token")
  @ResponseMessage("Post restored successfully!")
  restore(
    @Param("id", new ParseUUIDPipe()) id: string,
    @GetAuthorizationContext() ctx: AuthenticatedContext,
  ) {
    return this.postsService.restore(id, ctx);
  }
}
