/** Local browser fixture. Owns a unique schema and deletes only its own uploads. */
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { hash } from "bcryptjs";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { S3Client, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { AppModule } from "../../src/app.module";
import { configureApplication } from "../../src/main";
import { MessageImageEntity } from "../../src/modules/messages/entities/message-image.entity";
import { SessionRegistryService } from "../../src/common/session-registry/session-registry.service";
import {
  createTestDataSource,
  initializeTestDatabase,
  disposeTestDatabase,
  ownedTestSchema,
  testDatabaseEnv,
} from "../integration/database";
import {
  createTestUser,
  createTestCategory,
  createTestPost,
} from "../integration/fixtures";

async function main() {
  Object.assign(process.env, testDatabaseEnv());
  process.env.FE_DOMAIN = "http://localhost:3000";
  const ds = createTestDataSource();
  await initializeTestDatabase(ds);
  process.env.POSTGRES_SCHEMA = ownedTestSchema(ds);
  const password = "Fixture123!";
  const passwordHash = await hash(password, 10);
  const buyer = await createTestUser(ds, {
    fullName: "Minh Fixture",
    password: passwordHash,
  });
  const seller = await createTestUser(ds, {
    fullName: "Linh Fixture",
    password: passwordHash,
  });
  const category = await createTestCategory(ds);
  const post = await createTestPost(ds, seller.id, category.id, {
    title: "Laptop kiểm thử tích hợp",
    price: "5800000",
  });
  const app = await NestFactory.create(AppModule, {
    logger: false,
    abortOnError: false,
  });
  configureApplication(app);
  await app.listen(8080, "127.0.0.1");
  const jwt = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });
  const tokens = {
    buyer: jwt.sign({ id: buyer.id }, { expiresIn: "1h" }),
    seller: jwt.sign({ id: seller.id }, { expiresIn: "1h" }),
  };
  const created = await fetch("http://localhost:8080/api/v1/conversations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokens.buyer}`,
    },
    body: JSON.stringify({ postId: post.id }),
  });
  const conversationId = (await created.json()).data?.id as string;
  if (!conversationId) throw new Error("Fixture conversation creation failed");
  async function send(role: "buyer" | "seller", content: string) {
    const response = await fetch("http://localhost:8080/api/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokens[role]}`,
      },
      body: JSON.stringify({ conversationId, content, clientId: randomUUID() }),
    });
    if (!response.ok)
      throw new Error(`Fixture send failed: ${response.status}`);
    return (await response.json()).data;
  }
  await send("seller", "Chào bạn, laptop này vẫn còn nhé.");
  await send("buyer", "Mình muốn hẹn xem máy trực tiếp.");
  await send("seller", "Bạn có thể ghé chiều nay.");
  let shuttingDown = false;
  const control = createServer(async (request, response) => {
    try {
      if (request.url === "/send" && request.method === "POST") {
        let raw = "";
        for await (const chunk of request) raw += chunk;
        const body = JSON.parse(raw);
        const result = await send(
          body.role === "buyer" ? "buyer" : "seller",
          body.content ?? "Tin realtime từ người bán",
        );
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({ id: result.id, sequence: result.sequence }),
        );
      } else if (request.url === "/disconnect" && request.method === "POST") {
        for (const user of [buyer, seller])
          for (const session of app
            .get(SessionRegistryService)
            .eligibleSocketsForUser(user.id))
            session.socketRef.disconnect(true);
        response.end("disconnected");
      } else if (request.url === "/shutdown" && request.method === "POST") {
        response.end("stopping");
        void shutdown();
      } else {
        response.writeHead(404);
        response.end();
      }
    } catch (error) {
      response.writeHead(500);
      response.end(error instanceof Error ? error.message : "Fixture failure");
    }
  });
  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    await new Promise<void>((resolve) => control.close(() => resolve()));
    const keys = (await ds.getRepository(MessageImageEntity).find()).map(
      (image) => image.key,
    );
    await app.close();
    if (keys.length) {
      const s3 = new S3Client({
        region: "auto",
        endpoint: process.env.R2_ENDPOINT_URL,
        credentials: {
          accessKeyId: process.env.R2_ACCESS_KEY_ID!,
          secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
        },
      });
      try {
        const result = await s3.send(
          new DeleteObjectsCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Delete: { Objects: keys.map((Key) => ({ Key })) },
          }),
        );
        if (result.Errors?.length)
          throw new Error("Fixture upload cleanup failed");
      } finally {
        s3.destroy();
      }
    }
    await disposeTestDatabase(ds);
    console.log("Fixture schema and uploaded images cleaned.");
  }
  control.listen(8081, "127.0.0.1");
  process.once("SIGINT", () => {
    void shutdown();
  });
  process.once("SIGTERM", () => {
    void shutdown();
  });
  console.log(
    JSON.stringify({
      conversationId,
      buyer: buyer.email,
      seller: seller.email,
      password,
      schema: ownedTestSchema(ds),
      control: "http://127.0.0.1:8081",
    }),
  );
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
