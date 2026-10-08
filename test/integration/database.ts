import "reflect-metadata";
import { config } from "dotenv";
import { DataSource } from "typeorm";
import { randomUUID } from "crypto";
import { databaseOptions } from "../../src/config/database.config";
import { ConversationEntity } from "../../src/modules/conversations/entities/conversation.entity";
import { MessageEntity } from "../../src/modules/messages/entities/message.entity";
import { MessageImageEntity } from "../../src/modules/messages/entities/message-image.entity";
import { NotificationEntity } from "../../src/modules/notifications/notification.entity";
import { PostEntity } from "../../src/modules/posts/post.entity";
import { PostImageEntity } from "../../src/modules/post-images/post-image.entity";
import { UserEntity } from "../../src/modules/user/user.entity";
import { CategoryEntity } from "../../src/modules/categories/category.entity";
import { RefreshTokenEntity } from "../../src/modules/refresh-token/refresh-token.entity";
import { ReportEntity } from "../../src/modules/reports/report.entity";
import { FavoriteEntity } from "../../src/modules/favorites/favorite.entity";
import { ReviewEntity } from "../../src/modules/reviews/review.entity";

const ownedSchemas = new Set<string>();
export function testDatabaseEnv(): Record<string, string | undefined> {
  config({ quiet: true });
  const useConfigured = process.env.TEST_USE_CONFIGURED_SERVICES === "true";
  const env = { ...process.env };
  for (const suffix of ["HOST", "PORT", "USER", "PASSWORD", "DB"]) {
    const value =
      process.env[`TEST_POSTGRES_${suffix}`] ??
      (useConfigured ? process.env[`POSTGRES_${suffix}`] : undefined);
    if (!value)
      throw new Error(
        `Suite NOT RUN: set TEST_POSTGRES_${suffix} or explicitly opt in with TEST_USE_CONFIGURED_SERVICES=true`,
      );
    env[`POSTGRES_${suffix}`] = value;
  }
  env.POSTGRES_SYNCHRONIZE = "false";
  env.NODE_ENV = "test";
  return env;
}

export function createTestDataSource(): DataSource {
  const schema = `message_test_${randomUUID().replace(/-/g, "")}`;
  ownedSchemas.add(schema);
  return new DataSource({
    ...databaseOptions({ ...testDatabaseEnv(), POSTGRES_SCHEMA: schema }),
    entities: [
      UserEntity,
      CategoryEntity,
      PostEntity,
      PostImageEntity,
      RefreshTokenEntity,
      ReportEntity,
      FavoriteEntity,
      ReviewEntity,
      ConversationEntity,
      MessageEntity,
      MessageImageEntity,
      NotificationEntity,
    ],
  });
}

export function ownedTestSchema(ds: DataSource): string {
  const schema = (ds.options as { schema?: string }).schema;
  if (
    !schema ||
    !/^message_test_[a-f0-9]{32}$/.test(schema) ||
    !ownedSchemas.has(schema)
  ) {
    throw new Error(
      "Cleanup refused: schema is not owned by this test process",
    );
  }
  return schema;
}

export async function initializeTestDatabase(ds: DataSource): Promise<void> {
  const schema = ownedTestSchema(ds);
  await ds.initialize();
  await ds.query(`CREATE SCHEMA "${schema}"`);
  await ds.synchronize();
}

export async function disposeTestDatabase(ds: DataSource): Promise<void> {
  const schema = ownedTestSchema(ds);
  if (ds.isInitialized) {
    try {
      await ds.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await ds.destroy();
    }
  }
  ownedSchemas.delete(schema);
}
