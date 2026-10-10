import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { DataSource } from "typeorm";
import request from "supertest";
import { uuidv7 } from "uuidv7";
import { S3Client, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { AppModule } from "../../src/app.module";
import { configureApplication } from "../../src/main";
import { StorageService } from "../../src/modules/storage/storage.service";
import { PostImageEntity } from "../../src/modules/post-images/post-image.entity";
import { PostEntity } from "../../src/modules/posts/post.entity";
import { UserEntity } from "../../src/modules/user/user.entity";
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

describe("post images: real R2 upload, attachment and private reads", () => {
  let app: INestApplication, ds: DataSource, r2: S3Client;
  let seller: UserEntity, outsider: UserEntity, post: PostEntity;
  let jwt: JwtService;
  const keys = new Set<string>();
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOXYAAAAASUVORK5CYII=",
    "base64",
  );
  const token = (user: UserEntity) =>
    jwt.sign({ id: user.id, email: user.email }, { expiresIn: "15m" });
  const api = (user?: UserEntity) => {
    const auth = user ? { Authorization: `Bearer ${token(user)}` } : {};
    return {
      post: (path: string) =>
        request(app.getHttpServer()).post(`/api/v1/${path}`).set(auth),
      get: (path: string) =>
        request(app.getHttpServer()).get(`/api/v1/${path}`).set(auth),
      delete: (path: string) =>
        request(app.getHttpServer()).delete(`/api/v1/${path}`).set(auth),
    };
  };
  const count = () =>
    ds.getRepository(PostImageEntity).countBy({ postId: post.id });
  const key = (owner = seller.id, prefix = "posts") =>
    `${prefix}/${owner}/${uuidv7()}.png`;
  beforeAll(async () => {
    Object.assign(process.env, testDatabaseEnv());
    ds = createTestDataSource();
    await initializeTestDatabase(ds);
    process.env.POSTGRES_SCHEMA = ownedTestSchema(ds);
    process.env.POSTGRES_SYNCHRONIZE = "false";
    seller = await createTestUser(ds);
    outsider = await createTestUser(ds);
    post = await createTestPost(
      ds,
      seller.id,
      (await createTestCategory(ds)).id,
    );
    jwt = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });
    app = await NestFactory.create(AppModule, {
      logger: false,
      abortOnError: false,
    });
    configureApplication(app);
    await app.listen(0, "127.0.0.1");
    r2 = new S3Client({
      region: "auto",
      endpoint: process.env.R2_ENDPOINT_URL,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    try {
      if (r2 && keys.size) {
        const result = await r2.send(
          new DeleteObjectsCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Delete: { Objects: [...keys].map((Key) => ({ Key })) },
          }),
        );
        expect(result.Errors ?? []).toHaveLength(0);
      }
    } finally {
      r2?.destroy();
      if (app) await app.close();
      if (ds) await disposeTestDatabase(ds);
    }
  });
  it("uploads PNG to R2 and returns fresh readable URLs without persisting a signed URL", async () => {
    const result = await api(seller)
      .post("uploads/presign")
      .send({ purpose: "post", contentType: "image/png", size: png.length })
      .expect(201);
    const { uploadUrl, key: objectKey } = result.body.data;
    keys.add(objectKey);
    expect(objectKey).toMatch(new RegExp(`^posts/${seller.id}/`));
    const uploaded = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "image/png" },
      body: png,
    });
    await uploaded.arrayBuffer();
    expect(uploaded.ok).toBe(true);
    const created = await api(seller)
      .post(`posts/${post.id}/images`)
      .send({ key: objectKey })
      .expect(201);
    expect(created.body.data.urlExpiresAt).toBeTruthy();
    const stored = await ds
      .getRepository(PostImageEntity)
      .findOneByOrFail({ id: created.body.data.id });
    expect(stored.storageKey).toBe(objectKey);
    expect(stored.url).toBeNull();
    const list = await api().get(`posts/${post.id}/images`).expect(200);
    const image = list.body.data.find(
      (item: { id: string }) => item.id === stored.id,
    );
    const downloaded = await fetch(image.url);
    expect(downloaded.ok).toBe(true);
    expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(png);
    const conv = await api(outsider)
      .post("conversations")
      .send({ postId: post.id })
      .expect(201);
    const thumbnail = await fetch(conv.body.data.post.thumbnailUrl);
    expect(thumbnail.ok).toBe(true);
    expect(Buffer.from(await thumbnail.arrayBuffer())).toEqual(png);
    await api(outsider)
      .delete(`posts/${post.id}/images/${stored.id}`)
      .expect(403);
    await api(seller)
      .delete(`posts/${post.id}/images/${stored.id}`)
      .expect(200);
    expect(await count()).toBe(0);
  });
  it("rejects guests and non-owners before touching storage", async () => {
    const head = jest.spyOn(app.get(StorageService), "headObject");
    await api()
      .post("uploads/presign")
      .send({ purpose: "post", contentType: "image/png", size: 68 })
      .expect(401);
    await api(outsider)
      .post(`posts/${post.id}/images`)
      .send({ key: key(outsider.id) })
      .expect(403);
    expect(head).not.toHaveBeenCalled();
  });
  it("rejects foreign keys, chat keys and ambiguous or missing sources", async () => {
    const head = jest.spyOn(app.get(StorageService), "headObject");
    for (const body of [
      { key: key(outsider.id) },
      { key: key(seller.id, "messages") },
      { key: key(), url: "https://example.com/image.png" },
      {},
      { key: null },
      { url: null },
      { key: key(), sellerId: outsider.id },
    ])
      await api(seller).post(`posts/${post.id}/images`).send(body).expect(400);
    expect(head).not.toHaveBeenCalled();
    expect(await count()).toBe(0);
  });
  it("rejects missing objects and invalid HEAD metadata without storing images", async () => {
    const head = jest.spyOn(app.get(StorageService), "headObject");
    for (const metadata of [
      null,
      { contentLength: 68, contentType: "image/jpeg" },
      { contentLength: 0, contentType: "image/png" },
      {
        contentLength: app.get(StorageService).maxFileSizeBytes + 1,
        contentType: "image/png",
      },
    ]) {
      head.mockResolvedValue(metadata);
      await api(seller)
        .post(`posts/${post.id}/images`)
        .send({ key: key() })
        .expect(400);
    }
    expect(await count()).toBe(0);
  });
  it("keeps DB empty on HEAD and signing failures", async () => {
    const storage = app.get(StorageService);
    const head = jest
      .spyOn(storage, "headObject")
      .mockRejectedValue(new Error("HEAD failed"));
    await api(seller)
      .post(`posts/${post.id}/images`)
      .send({ key: key() })
      .expect(500);
    head.mockResolvedValue({ contentLength: 68, contentType: "image/png" });
    jest
      .spyOn(storage, "presignGet")
      .mockRejectedValue(new Error("sign failed"));
    await api(seller)
      .post(`posts/${post.id}/images`)
      .send({ key: key() })
      .expect(500);
    expect(await count()).toBe(0);
  });
  it("rechecks post existence after storage verification", async () => {
    const target = await createTestPost(ds, seller.id, post.categoryId);
    jest
      .spyOn(app.get(StorageService), "headObject")
      .mockImplementation(async () => {
        await ds.getRepository(PostEntity).softDelete(target.id);
        return { contentLength: 68, contentType: "image/png" };
      });
    await api(seller)
      .post(`posts/${target.id}/images`)
      .send({ key: key() })
      .expect(404);
    expect(
      await ds.getRepository(PostImageEntity).countBy({ postId: target.id }),
    ).toBe(0);
  });
  it("preserves the legacy external URL contract", async () => {
    const head = jest.spyOn(app.get(StorageService), "headObject");
    const image = await api(seller)
      .post(`posts/${post.id}/images`)
      .send({ url: "https://example.com/legacy.png" })
      .expect(201);
    expect(image.body.data.url).toBe("https://example.com/legacy.png");
    expect(image.body.data.urlExpiresAt).toBeUndefined();
    expect(head).not.toHaveBeenCalled();
    const rows = await api().get(`posts/${post.id}/images`).expect(200);
    expect(rows.body.data).toContainEqual(image.body.data);
    await api(seller)
      .delete(`posts/${post.id}/images/${image.body.data.id}`)
      .expect(200);
  });
});
