import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { DatabaseService } from "./database.service";

@Controller("health")
export class HealthController {
  constructor(private readonly database: DatabaseService) {}

  @Get()
  async check(): Promise<{ status: string; database: string }> {
    try {
      await this.database.checkConnection();
      return { status: "ok", database: "up" };
    } catch {
      throw new ServiceUnavailableException({
        status: "error",
        database: "down",
      });
    }
  }
}
