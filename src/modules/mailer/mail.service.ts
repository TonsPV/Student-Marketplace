import { Injectable } from "@nestjs/common";
import { MailerService } from "@nestjs-modules/mailer";
import type { ResetPasswordMail, PasswordChangedMail } from "./types/mail.type";

@Injectable()
export class MailService {
  constructor(private readonly mailer: MailerService) {}

  async sendResetPasswordOtp(input: ResetPasswordMail): Promise<void> {
    const result = await this.mailer.sendMail({
      to: input.email,
      subject: "Mã xác nhận đặt lại mật khẩu — Student Marketplace",
      template: "reset-password",
      context: {
        fullName: input.fullName,
        otp: input.otp,
        expiresInMinutes: 10,
      },
      text: `Chào ${input.fullName},\n\nMã đặt lại mật khẩu của bạn: ${input.otp}\nMã có hiệu lực trong 10 phút. Không chia sẻ mã với bất kỳ ai.\nNếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này.`,
    });
    // SMTP acceptance does not guarantee delivery to the recipient's inbox.
    if (!Array.isArray(result.accepted) || result.accepted.length === 0)
      throw new Error("SMTP did not accept the recipient");
  }

  async sendPasswordChanged(input: PasswordChangedMail): Promise<void> {
    await this.mailer.sendMail({
      to: input.email,
      subject: "Mật khẩu của bạn đã được thay đổi — Student Marketplace",
      template: "password-changed",
      context: { fullName: input.fullName },
      text: `Chào ${input.fullName},\n\nMật khẩu Student Marketplace của bạn đã được thay đổi. Nếu không phải bạn thực hiện, hãy yêu cầu đặt lại mật khẩu ngay và liên hệ hỗ trợ.`,
    });
  }
}
