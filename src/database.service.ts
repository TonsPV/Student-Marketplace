import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";

@Injectable()
export class DatabaseService {
  constructor(private readonly dataSource: DataSource) {}

  async checkConnection(): Promise<void> {
    await this.dataSource.query("SELECT 1");
  }
}
