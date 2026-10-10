export interface PasswordChangedMail {
  email: string;
  fullName: string;
}

export interface ResetPasswordMail extends PasswordChangedMail {
  otp: string;
}
