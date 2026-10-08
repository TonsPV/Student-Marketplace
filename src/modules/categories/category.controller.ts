import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
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
import { CategoryService } from "./category.service";
import { CreateCategoryDto } from "./dto/create-category.dto";
import { UpdateCategoryDto } from "./dto/update-category.dto";

@ApiTags("Categories")
@Controller("categories")
export class CategoryController {
  constructor(private readonly categories: CategoryService) {}

  @Get()
  @Public()
  @ApiOperation({ summary: "List categories with parent IDs" })
  @ResponseMessage("Categories retrieved successfully")
  findAll(@GetAuthorizationContext() ctx: AuthorizationContext) {
    return this.categories.findAll(ctx);
  }

  @Get(":id")
  @Public()
  @ResponseMessage("Category retrieved successfully")
  findOne(
    @Param("id", new ParseUUIDPipe()) id: string,
    @GetAuthorizationContext() ctx: AuthorizationContext,
  ) {
    return this.categories.findOne(id, ctx);
  }

  @Post()
  @CheckPolicies({ action: "create", subject: "Category" })
  @ApiBearerAuth("access-token")
  @ResponseMessage("Category created successfully")
  create(
    @Body() dto: CreateCategoryDto,
    @GetAuthorizationContext() ctx: AuthenticatedContext,
  ) {
    return this.categories.create(dto, ctx);
  }

  @Patch(":id")
  @CheckPolicies({ action: "update", subject: "Category" })
  @ApiBearerAuth("access-token")
  @ResponseMessage("Category updated successfully")
  update(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateCategoryDto,
    @GetAuthorizationContext() ctx: AuthenticatedContext,
  ) {
    return this.categories.update(id, dto, ctx);
  }

  @Delete(":id")
  @CheckPolicies({ action: "delete", subject: "Category" })
  @ApiBearerAuth("access-token")
  @ResponseMessage("Category deleted successfully")
  remove(
    @Param("id", new ParseUUIDPipe()) id: string,
    @GetAuthorizationContext() ctx: AuthenticatedContext,
  ) {
    return this.categories.remove(id, ctx);
  }
}
