import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  GetUser,
  ResponseMessage,
} from "../../common/decorators/customize.decorator";
import type { UserInterface } from "../../shared/interfaces/user.interface";
import { PresignUploadDto } from "./dto/presign-upload.dto";
import { StorageService } from "./storage.service";

@ApiTags("Uploads")
@ApiBearerAuth("access-token")
@Controller("uploads")
export class UploadsController {
  constructor(private readonly storageService: StorageService) {}

  @Post("presign")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Xin presigned PUT URL để upload ảnh chat" })
  @ResponseMessage("Upload URL created successfully")
  presign(@Body() dto: PresignUploadDto, @GetUser() user: UserInterface) {
    // API không nhận/upload bytes file; chỉ cấp URL để FE PUT trực tiếp.
    return this.storageService.presignPut(
      user.id,
      dto.purpose,
      dto.contentType,
      dto.size,
    );
  }
}
