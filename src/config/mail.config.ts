import { ConfigService } from "@nestjs/config";
import type { MailerOptions } from "@nestjs-modules/mailer";
import { HandlebarsAdapter } from "@nestjs-modules/mailer/adapters/handlebars.adapter";
import { join } from "node:path";

export function mailOptions(config: ConfigService): MailerOptions {
  const required = (name: string): string => {
    const value = config.get<string>(name);
    if (!value?.trim()) throw new Error(`${name} is required`);
    return value;
  };
  const port = Number(config.get<string>("EMAIL_PORT") ?? "465");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("EMAIL_PORT must be an integer between 1 and 65535");
  }
  const secureValue =
    config.get<string>("EMAIL_SECURE") ?? String(port === 465);
  if (!["true", "false"].includes(secureValue))
    throw new Error("EMAIL_SECURE must be true or false");
  const secure = secureValue === "true";
  if ((port === 465 && !secure) || (port === 587 && secure)) {
    throw new Error(
      "Use EMAIL_SECURE=true for port 465 and false for port 587",
    );
  }
  return {
    transport: {
      host: required("EMAIL_HOST"),
      port,
      secure,
      requireTLS: !secure,
      auth: { user: required("EMAIL_USER"), pass: required("EMAIL_PASSWORD") },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000,
      tls: { rejectUnauthorized: true },
    },
    defaults: { from: required("MAIL_FROM") },
    template: {
      dir: join(__dirname, "../modules/mailer/templates"),
      // Nest copies assets from sourceRoot to dist/modules. Additional TS files
      // outside src can make TypeScript emit JS under dist/src instead.
      dirs: [join(__dirname, "../../modules/mailer/templates")],
      adapter: new HandlebarsAdapter(),
      options: { strict: true },
    },
    preview: false,
    verifyTransporters: false,
    sendTimeout: 30000,
  };
}
