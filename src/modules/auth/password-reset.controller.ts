import { Body, Controller, HttpCode, Post, UseGuards } from "@nestjs/common";
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import {
  Public,
  ResponseMessage,
} from "../../common/decorators/customize.decorator";
import { PasswordResetService } from "./services/password-reset.service";
import {
  ResetPasswordDto,
  SendResetPasswordDto,
  VerifyOtpDto,
} from "./dto/reset-password.dto";

@ApiTags("auth")
@Controller("auth")
export class PasswordResetController {
  constructor(private readonly resets: PasswordResetService) {}

  @Post("forgot-password")
  @HttpCode(200)
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ResponseMessage(
    "If the account is eligible, a reset code will be sent to its email.",
  )
  @ApiOperation({
    summary: "Request a password reset code",
    description:
      "Response does not confirm account existence or email delivery. 60-second cooldown and 5 requests/user/hour.",
  })
  @ApiBody({ type: SendResetPasswordDto })
  @ApiResponse({
    status: 200,
    description: "Request processed; data: { requested: true }",
  })
  @ApiResponse({ status: 429, description: "IP rate limit exceeded" })
  requestReset(@Body() dto: SendResetPasswordDto) {
    return this.resets.requestReset(dto.email);
  }

  @Post("verify-reset-otp")
  @HttpCode(200)
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ResponseMessage("Reset code verified.")
  @ApiOperation({ summary: "Exchange an OTP for a one-use reset token" })
  @ApiBody({ type: VerifyOtpDto })
  @ApiResponse({
    status: 200,
    description: "data: { resetToken, expiresAt }; token expires in 5 minutes",
  })
  @ApiResponse({
    status: 400,
    description: "Invalid, expired or already used code",
  })
  @ApiResponse({ status: 429, description: "IP rate limit exceeded" })
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.resets.verifyOtp(dto.email, dto.otp);
  }

  @Post("reset-password")
  @HttpCode(200)
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ResponseMessage("Password reset successfully. Please log in again.")
  @ApiOperation({ summary: "Reset password and revoke all refresh tokens" })
  @ApiBody({ type: ResetPasswordDto })
  @ApiResponse({
    status: 200,
    description: "data: { changed: true }; no login tokens issued",
  })
  @ApiResponse({ status: 400, description: "Invalid token or password" })
  @ApiResponse({ status: 429, description: "IP rate limit exceeded" })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.resets.resetPassword(dto);
  }
}
