import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiTags } from "@nestjs/swagger";
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
import { CreatePostImageDto } from "./dto/create-post-image.dto";
import { PostImagesService } from "./post-images.service";

@ApiTags("post-images")
@Controller("posts/:postId/images")
export class PostImagesController {
  constructor(private readonly postImagesService: PostImagesService) {}

  @Post()
  @CheckPolicies({ action: "manageImages", subject: "Post" })
  @ApiBearerAuth("access-token")
  @ApiBody({ type: CreatePostImageDto })
  @ResponseMessage("Post image created successfully!")
  create(
    @Param("postId", new ParseUUIDPipe()) postId: string,
    @Body() dto: CreatePostImageDto,
    @GetAuthorizationContext() ctx: AuthenticatedContext,
  ) {
    return this.postImagesService.create(postId, dto, ctx);
  }

  @Get()
  @Public()
  @ResponseMessage("Post images retrieved successfully!")
  findAll(
    @Param("postId", new ParseUUIDPipe()) postId: string,
    @GetAuthorizationContext() ctx: AuthorizationContext,
  ) {
    return this.postImagesService.findAll(postId, ctx);
  }

  @Delete(":imageId")
  @CheckPolicies({ action: "manageImages", subject: "Post" })
  @ApiBearerAuth("access-token")
  @ResponseMessage("Post image deleted successfully!")
  remove(
    @Param("postId", new ParseUUIDPipe()) postId: string,
    @Param("imageId", new ParseUUIDPipe()) imageId: string,
    @GetAuthorizationContext() ctx: AuthenticatedContext,
  ) {
    return this.postImagesService.remove(postId, imageId, ctx);
  }
}
