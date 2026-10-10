import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ResponseMessage } from "../../common/decorators/customize.decorator";
import { CheckPolicies } from "../authorization/decorators/check-policies.decorator";
import { GetAuthorizationContext } from "../authorization/decorators/get-authorization-context.decorator";
import type { AuthenticatedContext } from "../authorization/authorization.types";
import { PresignUploadDto } from "./dto/presign-upload.dto";
import { StorageService } from "./storage.service";

@ApiTags("Uploads")
@ApiBearerAuth("access-token")
@Controller("uploads")
export class UploadsController {
  constructor(private readonly storageService: StorageService) {}

  @Post("presign")
  @CheckPolicies({ action: "create", subject: "Upload" })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: "Request presigned PUT URL for a message or post image",
  })
  @ResponseMessage("Upload URL created successfully")
  presign(
    @Body() dto: PresignUploadDto,
    @GetAuthorizationContext() ctx: AuthenticatedContext,
  ) {
    return this.storageService.presignPut(
      ctx,
      dto.purpose,
      dto.contentType,
      dto.size,
    );
  }
}
