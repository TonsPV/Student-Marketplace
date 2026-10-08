import { Controller, Get } from "@nestjs/common";
import { AuthOnly } from "./modules/authorization/decorators/auth-only.decorator";

@Controller()
export class AppController {
  @Get()
  @AuthOnly()
  getStatus(): { service: string; status: string } {
    return {
      service: "student-marketplace-api",
      status: "ok",
    };
  }
}
