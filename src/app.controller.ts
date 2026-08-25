import { Controller, Get } from "@nestjs/common";

@Controller()
export class AppController {
  @Get()
  getStatus(): { service: string; status: string } {
    return {
      service: "student-marketplace-api",
      status: "ok",
    };
  }
}
