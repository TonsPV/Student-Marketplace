import "dotenv/config";
import { DataSource } from "typeorm";
import { databaseOptions } from "../config/database.config";

/**
 * DataSource cho TypeORM CLI (migration prod/test).
 * DB dev trống dùng synchronize của AppModule; DB có dữ liệu đi bằng
 * migration này + quy trình backfill spec §3.4 (backup, dry-run, dừng writes).
 */
export default new DataSource({
  ...databaseOptions(),
  synchronize: false,
  entities: [],
  migrations: ["src/database/migrations/*.ts"],
});
