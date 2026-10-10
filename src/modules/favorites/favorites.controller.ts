import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { ResponseMessage } from "../../common/decorators/customize.decorator";
import { CheckPolicies } from "../authorization/decorators/check-policies.decorator";
import { GetAuthorizationContext } from "../authorization/decorators/get-authorization-context.decorator";
import type { AuthenticatedContext } from "../authorization/authorization.types";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { CreateFavoriteDto } from "./dto/create-favorite.dto";
import { FavoritesService } from "./favorites.service";

@ApiTags("favorites")
@ApiBearerAuth("access-token")
@ApiUnauthorizedResponse({ description: "Missing or invalid access token" })
@Controller("favorites")
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  @Post()
  @CheckPolicies({ action: "create", subject: "Favorite" })
  @ApiOperation({ summary: "Add an active post to my favorites" })
  @ApiCreatedResponse({ description: "Favorite created" })
  @ApiNotFoundResponse({ description: "Post does not exist or is unavailable" })
  @ApiConflictResponse({ description: "Post is already in your favorites" })
  @ResponseMessage("Favorite added successfully!")
  create(
    @Body() dto: CreateFavoriteDto,
    @GetAuthorizationContext() ctx: AuthenticatedContext,
  ) {
    return this.favoritesService.create(ctx, dto.postId);
  }

  @Get()
  @CheckPolicies({ action: "read", subject: "Favorite" })
  @ApiOperation({
    summary: "List my favorites, newest first",
    description:
      "Includes active and sold posts; excludes hidden and soft-deleted posts. Returns data.items and data.meta with page, limit, total, totalPages.",
  })
  @ApiOkResponse({
    description:
      "Paginated favorites including post, seller, category and images",
  })
  @ResponseMessage("Favorites retrieved successfully!")
  findAll(
    @GetAuthorizationContext() ctx: AuthenticatedContext,
    @Query() query: PaginationDto,
  ) {
    return this.favoritesService.findAll(ctx, query);
  }

  @Delete(":postId")
  @CheckPolicies({ action: "delete", subject: "Favorite" })
  @ApiOperation({
    summary: "Remove a post from my favorites",
    description: "Idempotent; also works for hidden or deleted posts.",
  })
  @ApiOkResponse({ description: "Favorite removed (or already absent)" })
  @ResponseMessage("Favorite removed successfully!")
  remove(
    @Param("postId", new ParseUUIDPipe()) postId: string,
    @GetAuthorizationContext() ctx: AuthenticatedContext,
  ) {
    return this.favoritesService.remove(ctx, postId);
  }
}
