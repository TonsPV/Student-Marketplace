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
import {
  GetUser,
  ResponseMessage,
} from "../../common/decorators/customize.decorator";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { UserInterface } from "../../shared/interfaces/user.interface";
import { CreateFavoriteDto } from "./dto/create-favorite.dto";
import { FavoritesService } from "./favorites.service";

@ApiTags("favorites")
@ApiBearerAuth("access-token")
@ApiUnauthorizedResponse({ description: "Missing or invalid access token" })
@Controller("favorites")
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  @Post()
  @ApiOperation({ summary: "Add an active post to my favorites" })
  @ApiCreatedResponse({ description: "Favorite created" })
  @ApiNotFoundResponse({ description: "Post does not exist or is unavailable" })
  @ApiConflictResponse({ description: "Post is already in your favorites" })
  @ResponseMessage("Favorite added successfully!")
  create(@Body() dto: CreateFavoriteDto, @GetUser() user: UserInterface) {
    return this.favoritesService.create(user.id, dto.postId);
  }

  @Get()
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
  findAll(@GetUser() user: UserInterface, @Query() query: PaginationDto) {
    return this.favoritesService.findAll(user.id, query);
  }

  @Delete(":postId")
  @ApiOperation({
    summary: "Remove a post from my favorites",
    description: "Idempotent; also works for hidden or deleted posts.",
  })
  @ApiOkResponse({ description: "Favorite removed (or already absent)" })
  @ResponseMessage("Favorite removed successfully!")
  remove(
    @Param("postId", new ParseUUIDPipe()) postId: string,
    @GetUser() user: UserInterface,
  ) {
    return this.favoritesService.remove(user.id, postId);
  }
}
