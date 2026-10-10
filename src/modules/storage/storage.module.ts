import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { r2Config, uploadConfig } from "../../config/r2.config";
import { StorageService } from "./storage.service";
import { UploadsController } from "./uploads.controller";
import { AuthorizationModule } from "../authorization/authorization.module";

@Module({
  imports: [
    ConfigModule.forFeature(r2Config),
    ConfigModule.forFeature(uploadConfig),
    AuthorizationModule,
  ],
  controllers: [UploadsController],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
