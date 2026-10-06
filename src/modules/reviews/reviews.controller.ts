import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiTags } from "@nestjs/swagger";
import {
  GetUser,
  Public,
  ResponseMessage,
} from "../../common/decorators/customize.decorator";
import { UserInterface } from "../../shared/interfaces/user.interface";
import { CreateReviewDto } from "./dto/create-review.dto";
import { FindReviewsDto } from "./dto/find-reviews.dto";
import { UpdateReviewDto } from "./dto/update-review.dto";
import { ReviewsService } from "./reviews.service";

@ApiTags("reviews")
@Controller()
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Post("reviews")
  @ApiBearerAuth("access-token")
  @ApiBody({ type: CreateReviewDto })
  @ResponseMessage("Review created successfully!")
  create(@Body() dto: CreateReviewDto, @GetUser() user: UserInterface) {
    return this.reviewsService.create(dto, user.id);
  }

  @Get("reviews/:id")
  @Public()
  @ResponseMessage("Review retrieved successfully!")
  findOne(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.reviewsService.findOne(id);
  }

  @Get("posts/:postId/reviews")
  @Public()
  @ResponseMessage("Post reviews retrieved successfully!")
  findByPost(
    @Param("postId", new ParseUUIDPipe()) postId: string,
    @Query() query: FindReviewsDto,
  ) {
    return this.reviewsService.findByPost(postId, query);
  }

  @Get("users/:sellerId/reviews")
  @Public()
  @ResponseMessage("Seller reviews retrieved successfully!")
  findBySeller(
    @Param("sellerId", new ParseUUIDPipe()) sellerId: string,
    @Query() query: FindReviewsDto,
  ) {
    return this.reviewsService.findBySeller(sellerId, query);
  }

  @Patch("reviews/:id")
  @ApiBearerAuth("access-token")
  @ApiBody({ type: UpdateReviewDto })
  @ResponseMessage("Review updated successfully!")
  update(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateReviewDto,
    @GetUser() user: UserInterface,
  ) {
    return this.reviewsService.update(id, dto, user.id);
  }

  @Delete("reviews/:id")
  @ApiBearerAuth("access-token")
  @ResponseMessage("Review deleted successfully!")
  remove(
    @Param("id", new ParseUUIDPipe()) id: string,
    @GetUser() user: UserInterface,
  ) {
    return this.reviewsService.remove(id, user.id);
  }
}
