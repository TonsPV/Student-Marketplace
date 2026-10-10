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
  Public,
  ResponseMessage,
} from "../../common/decorators/customize.decorator";
import { CheckPolicies } from "../authorization/decorators/check-policies.decorator";
import { GetAuthorizationContext } from "../authorization/decorators/get-authorization-context.decorator";
import type {
  AuthenticatedContext,
  AuthorizationContext,
} from "../authorization/authorization.types";
import { CreateReviewDto } from "./dto/create-review.dto";
import { FindReviewsDto } from "./dto/find-reviews.dto";
import { UpdateReviewDto } from "./dto/update-review.dto";
import { ReviewsService } from "./reviews.service";

@ApiTags("reviews")
@Controller()
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Post("reviews")
  @CheckPolicies({ action: "create", subject: "Review" })
  @ApiBearerAuth("access-token")
  @ApiBody({ type: CreateReviewDto })
  @ResponseMessage("Review created successfully!")
  create(
    @Body() dto: CreateReviewDto,
    @GetAuthorizationContext() ctx: AuthenticatedContext,
  ) {
    return this.reviewsService.create(dto, ctx);
  }

  @Get("reviews/:id")
  @Public()
  @ResponseMessage("Review retrieved successfully!")
  findOne(
    @Param("id", new ParseUUIDPipe()) id: string,
    @GetAuthorizationContext() ctx: AuthorizationContext,
  ) {
    return this.reviewsService.findOne(id, ctx);
  }

  @Get("posts/:postId/reviews")
  @Public()
  @ResponseMessage("Post reviews retrieved successfully!")
  findByPost(
    @Param("postId", new ParseUUIDPipe()) postId: string,
    @Query() query: FindReviewsDto,
    @GetAuthorizationContext() ctx: AuthorizationContext,
  ) {
    return this.reviewsService.findByPost(postId, query, ctx);
  }

  @Get("users/:sellerId/reviews")
  @Public()
  @ResponseMessage("Seller reviews retrieved successfully!")
  findBySeller(
    @Param("sellerId", new ParseUUIDPipe()) sellerId: string,
    @Query() query: FindReviewsDto,
    @GetAuthorizationContext() ctx: AuthorizationContext,
  ) {
    return this.reviewsService.findBySeller(sellerId, query, ctx);
  }

  @Patch("reviews/:id")
  @CheckPolicies({ action: "update", subject: "Review" })
  @ApiBearerAuth("access-token")
  @ApiBody({ type: UpdateReviewDto })
  @ResponseMessage("Review updated successfully!")
  update(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateReviewDto,
    @GetAuthorizationContext() ctx: AuthenticatedContext,
  ) {
    return this.reviewsService.update(id, dto, ctx);
  }

  @Delete("reviews/:id")
  @CheckPolicies({ action: "delete", subject: "Review" })
  @ApiBearerAuth("access-token")
  @ResponseMessage("Review deleted successfully!")
  remove(
    @Param("id", new ParseUUIDPipe()) id: string,
    @GetAuthorizationContext() ctx: AuthenticatedContext,
  ) {
    return this.reviewsService.remove(id, ctx);
  }
}
