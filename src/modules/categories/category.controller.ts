import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  Public,
  ResponseMessage,
} from "../../common/decorators/customize.decorator";
import { AdminGuard } from "../../common/guards/admin.guard";
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
  findAll() {
    return this.categories.findAll();
  }

  @Get(":id")
  @Public()
  @ResponseMessage("Category retrieved successfully")
  findOne(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.categories.findOne(id);
  }

  @Post()
  @UseGuards(AdminGuard)
  @ApiBearerAuth("access-token")
  @ResponseMessage("Category created successfully")
  create(@Body() dto: CreateCategoryDto) {
    return this.categories.create(dto);
  }

  @Patch(":id")
  @UseGuards(AdminGuard)
  @ApiBearerAuth("access-token")
  @ResponseMessage("Category updated successfully")
  update(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.categories.update(id, dto);
  }

  @Delete(":id")
  @UseGuards(AdminGuard)
  @ApiBearerAuth("access-token")
  @ResponseMessage("Category deleted successfully")
  remove(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.categories.remove(id);
  }
}
