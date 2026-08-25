import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Pool } from "pg";

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor(config: ConfigService) {
    this.pool = new Pool({
      database: config.getOrThrow<string>("POSTGRES_DB"),
      host: config.getOrThrow<string>("POSTGRES_HOST"),
      password: config.getOrThrow<string>("POSTGRES_PASSWORD"),
      port: config.getOrThrow<number>("POSTGRES_PORT"),
      user: config.getOrThrow<string>("POSTGRES_USER"),
    });
  }

  async checkConnection(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
