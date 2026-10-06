import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { r2Config, uploadConfig } from "../../config/r2.config";
import { StorageService } from "./storage.service";
import { UploadsController } from "./uploads.controller";

@Module({
  imports: [
    ConfigModule.forFeature(r2Config),
    ConfigModule.forFeature(uploadConfig),
  ],
  controllers: [UploadsController],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
