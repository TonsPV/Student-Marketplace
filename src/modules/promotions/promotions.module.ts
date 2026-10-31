import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Promotion } from "./promotion.entity";
@Module({
  imports: [TypeOrmModule.forFeature([Promotion])],
  exports: [TypeOrmModule],
})
export class PromotionsModule {}
