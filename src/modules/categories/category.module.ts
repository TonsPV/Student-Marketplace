import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CategoryController } from "./category.controller";
import { CategoryEntity } from "./category.entity";
import { CategoryService } from "./category.service";
import { AuthorizationModule } from "../authorization/authorization.module";

@Module({
  imports: [TypeOrmModule.forFeature([CategoryEntity]), AuthorizationModule],
  controllers: [CategoryController],
  providers: [CategoryService],
  exports: [CategoryService],
})
export class CategoryModule {}
