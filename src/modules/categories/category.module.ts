import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AdminGuard } from "../../common/guards/admin.guard";
import { UserEntity } from "../user/user.entity";
import { CategoryController } from "./category.controller";
import { CategoryEntity } from "./category.entity";
import { CategoryService } from "./category.service";

@Module({
  imports: [TypeOrmModule.forFeature([CategoryEntity, UserEntity])],
  controllers: [CategoryController],
  providers: [CategoryService, AdminGuard],
  exports: [CategoryService],
})
export class CategoryModule {}
