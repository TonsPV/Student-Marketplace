import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { TemporaryRecordEntity } from "./temporary-record.entity";

@Module({
  imports: [TypeOrmModule.forFeature([TemporaryRecordEntity])],
})
export class TemporaryModule {}
