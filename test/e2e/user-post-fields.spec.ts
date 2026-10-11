import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { DataSource } from "typeorm";
import { randomUUID } from "crypto";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { configureApplication } from "../../src/main";
import { UserEntity } from "../../src/modules/user/user.entity";
import {
  PostEntity,
  PostStatus,
  PostCondition,
} from "../../src/modules/posts/post.entity";
import { UpdateUserDto } from "../../src/modules/user/dto/update-user.dto";
import { AuthService } from "../../src/modules/auth/services/auth.service";
import { AuthorizationService } from "../../src/modules/authorization/authorization.service";
import { PostsService } from "../../src/modules/posts/posts.service";
import { UserService } from "../../src/modules/user/user.service";
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

describe("university and locationName API contracts", () => {
  let app: INestApplication, ds: DataSource, jwt: JwtService;
  let owner: UserEntity,
    outsider: UserEntity,
    admin: UserEntity,
    categoryId: string;
  const body = () => ({
    categoryId,
    title: "Sách Giải tích 1",
    description: "Sách còn mới, có ghi chú bằng bút chì.",
    price: "50000",
    condition: PostCondition.LIKE_NEW,
  });
  const registerBody = () => ({
    email: `${randomUUID()}@example.com`,
    password: "test-password-123",
    fullName: "Sinh viên",
    phone: "0123456789",
  });
  const auth = (user: UserEntity) => ({
    Authorization: `Bearer ${jwt.sign({ id: user.id }, { expiresIn: "15m" })}`,
  });
  const http = () => request(app.getHttpServer());
  const patchUser = (value: object) =>
    http().patch("/api/v1/user/me").set(auth(owner)).send(value);
  const patchPost = (id: string, value: object, user = owner) =>
    http().patch(`/api/v1/posts/${id}`).set(auth(user)).send(value);

  beforeAll(async () => {
    Object.assign(process.env, testDatabaseEnv(), {
      JWT_ACCESS_SECRET: "test-access-secret-not-for-production",
      JWT_ACCESS_EXPIRED: "15m",
      JWT_REFRESH_SECRET: "test-refresh-secret-not-for-production",
      JWT_REFRESH_EXPIRED: "7d",
      GOOGLE_CLIENT_ID: "test-google-client",
      GOOGLE_CLIENT_SECRET: "test-google-secret",
      GOOGLE_REDIRECT_URI: "http://localhost/api/v1/auth/google/callback",
      FE_DOMAIN: "http://localhost:3000",
      R2_ACCESS_KEY_ID: "test-key",
      R2_SECRET_ACCESS_KEY: "test-secret",
      R2_BUCKET_NAME: "test-bucket",
      R2_ENDPOINT_URL: "https://test-account.r2.cloudflarestorage.com",
      SEED_ADMIN_EMAIL: "fields-test-admin@example.com",
      SEED_ADMIN_NAME: "Test Admin",
      SEED_ADMIN_PASSWORD: "test-admin-password",
      SEED_ADMIN_PHONE: "1234567890",
    });
    ds = createTestDataSource();
    await initializeTestDatabase(ds);
    process.env.POSTGRES_SCHEMA = ownedTestSchema(ds);
    [owner, outsider, admin] = await Promise.all([
      createTestUser(ds),
      createTestUser(ds),
      createTestUser(ds, { isAdmin: true }),
    ]);
    categoryId = (await createTestCategory(ds)).id;
    jwt = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });
    app = await NestFactory.create(AppModule, {
      logger: false,
      abortOnError: false,
    });
    configureApplication(app);
    await app.init();
  });
  afterAll(async () => {
    if (app) await app.close();
    if (ds) await disposeTestDatabase(ds);
  });

  it.each([undefined, null, "  Đại học Bách khoa  "])(
    "registers with university %p while preserving the registration response",
    async (university) => {
      const response = await http()
        .post("/api/v1/auth/register")
        .send({
          ...registerBody(),
          ...(university === undefined ? {} : { university }),
        })
        .expect(201);
      expect(Object.keys(response.body.data).sort()).toEqual([
        "createdAt",
        "id",
      ]);
      const user = await ds
        .getRepository(UserEntity)
        .findOneByOrFail({ id: response.body.data.id });
      expect(user.university).toBe(
        typeof university === "string" ? university.trim() : null,
      );
      const profile = await http()
        .get("/api/v1/user/me")
        .set(auth(user))
        .expect(200);
      expect(profile.body.data.university).toBe(user.university);
    },
  );

  it("Google registration leaves university NULL and keeps the auth principal unchanged", async () => {
    const email = `${randomUUID()}@example.com`;
    const principal = await app
      .get(AuthService)
      .validateGoogleUser({ email, name: "Google User" });
    expect(principal).not.toHaveProperty("university");
    expect(
      (await ds.getRepository(UserEntity).findOneByOrFail({ email }))
        .university,
    ).toBeNull();
  });

  it("reads, trims, preserves on omission and clears university in profiles", async () => {
    expect(
      (await patchUser({ university: "  Đại học Quốc gia  " }).expect(200)).body
        .data.university,
    ).toBe("Đại học Quốc gia");
    expect(
      (await patchUser({ fullName: "Sinh viên mới" }).expect(200)).body.data
        .university,
    ).toBe("Đại học Quốc gia");
    for (const path of ["user/me", `user/${owner.id}`]) {
      const response = await http()
        .get(`/api/v1/${path}`)
        .set(auth(owner))
        .expect(200);
      expect(response.body.data.university).toBe("Đại học Quốc gia");
      expect(response.body.data).not.toHaveProperty("password");
    }
    expect(
      (await patchUser({ university: null }).expect(200)).body.data.university,
    ).toBeNull();
    expect(
      (await ds.getRepository(UserEntity).findOneByOrFail({ id: owner.id }))
        .university,
    ).toBeNull();
  });

  it.each([undefined, null, "  Cổng trường Bách khoa  "])(
    "creates a post with locationName %p independently of coordinates",
    async (locationName) => {
      const response = await http()
        .post("/api/v1/posts")
        .set(auth(owner))
        .send({
          ...body(),
          ...(locationName === undefined ? {} : { locationName }),
        })
        .expect(201);
      expect(response.body.data.locationName).toBe(
        typeof locationName === "string" ? locationName.trim() : null,
      );
      expect(response.body.data.location).toBeNull();
      const post = await ds
        .getRepository(PostEntity)
        .findOneByOrFail({ id: response.body.data.id });
      expect(post.locationName).toBe(response.body.data.locationName);
    },
  );

  it("returns locationName in detail/list/search and preserves or clears it on PATCH", async () => {
    const post = await createTestPost(ds, owner.id, categoryId, {
      locationName: "Thư viện",
      location: { type: "Point", coordinates: [106.7, 10.77] },
    });
    expect(
      (await patchPost(post.id, { locationName: "  Cổng chính  " }).expect(200))
        .body.data.locationName,
    ).toBe("Cổng chính");
    expect(
      (await patchPost(post.id, { title: "Sách Toán mới" }).expect(200)).body
        .data.locationName,
    ).toBe("Cổng chính");
    const detail = await http().get(`/api/v1/posts/${post.id}`).expect(200);
    expect(detail.body.data.locationName).toBe("Cổng chính");
    expect(detail.body.data.location.coordinates).toEqual([106.7, 10.77]);
    expect(detail.body.data.seller).not.toHaveProperty("university");
    for (const path of [
      "posts?limit=100",
      "posts/me?limit=100",
      "posts/search?q=Sách&limit=50",
    ]) {
      const response = await http()
        .get(`/api/v1/${path}`)
        .set(auth(owner))
        .expect(200);
      expect(
        response.body.data.items.find(
          (item: { id: string }) => item.id === post.id,
        ).locationName,
      ).toBe("Cổng chính");
    }
    expect(
      (await patchPost(post.id, { locationName: null }).expect(200)).body.data
        .locationName,
    ).toBeNull();
    const saved = await ds
      .getRepository(PostEntity)
      .findOneByOrFail({ id: post.id });
    expect(saved.locationName).toBeNull();
    expect(saved.location?.coordinates).toEqual([106.7, 10.77]);
  });

  it("accepts the length boundaries after trimming", async () => {
    const university = "Đ".repeat(150);
    const locationName = "ạ".repeat(255);
    await http()
      .post("/api/v1/auth/register")
      .send({ ...registerBody(), university: ` ${university} ` })
      .expect(201);
    expect(
      (await patchUser({ university: ` ${university} ` }).expect(200)).body.data
        .university,
    ).toBe(university);
    const response = await http()
      .post("/api/v1/posts")
      .set(auth(owner))
      .send({ ...body(), locationName: ` ${locationName} ` })
      .expect(201);
    expect(response.body.data.locationName).toBe(locationName);
    expect(
      (
        await patchPost(response.body.data.id, {
          locationName: ` ${locationName} `,
        }).expect(200)
      ).body.data.locationName,
    ).toBe(locationName);
    expect(
      (
        await patchPost(response.body.data.id, { locationName: " A " }).expect(
          200,
        )
      ).body.data.locationName,
    ).toBe("A");
    expect(
      (await patchUser({ university: " A " }).expect(200)).body.data.university,
    ).toBe("A");
  });

  it.each(["", "   ", 42, false, {}, [], ["text"]])(
    "rejects invalid types or blank values %p on every write endpoint",
    async (value) => {
      await http()
        .post("/api/v1/auth/register")
        .send({ ...registerBody(), university: value })
        .expect(400);
      await patchUser({ university: value }).expect(400);
      await http()
        .post("/api/v1/posts")
        .set(auth(owner))
        .send({ ...body(), locationName: value })
        .expect(400);
      const post = await createTestPost(ds, owner.id, categoryId, {
        locationName: "Giữ nguyên",
      });
      await patchPost(post.id, { locationName: value }).expect(400);
      expect(
        (await ds.getRepository(PostEntity).findOneByOrFail({ id: post.id }))
          .locationName,
      ).toBe("Giữ nguyên");
    },
  );

  it("rejects overlong values on registration, profile, post creation and update", async () => {
    await http()
      .post("/api/v1/auth/register")
      .send({ ...registerBody(), university: "a".repeat(151) })
      .expect(400);
    await patchUser({ university: "a".repeat(151) }).expect(400);
    await http()
      .post("/api/v1/posts")
      .set(auth(owner))
      .send({ ...body(), locationName: "a".repeat(256) })
      .expect(400);
    const post = await createTestPost(ds, owner.id, categoryId);
    await patchPost(post.id, { locationName: "a".repeat(256) }).expect(400);
  });

  it("keeps owner-only updates and existing hidden/locked/guest restrictions", async () => {
    const post = await createTestPost(ds, owner.id, categoryId, {
      locationName: "Cổng trường",
    });
    for (const actor of [outsider, admin]) {
      await patchPost(post.id, { locationName: "Forbidden" }, actor).expect(
        403,
      );
      const context = app
        .get(AuthorizationService)
        .createAuthenticatedContext(actor);
      // Internal service callers must also be unable to write another user's profile.
      expect(() =>
        app
          .get(AuthorizationService)
          .assertUpdateFields(
            context,
            "update",
            "User",
            { id: owner.id, deletedAt: null, isLocked: false },
            { university: "Forbidden" },
          ),
      ).toThrow();
    }
    expect(
      (await ds.getRepository(PostEntity).findOneByOrFail({ id: post.id }))
        .locationName,
    ).toBe("Cổng trường");
    await http()
      .patch("/api/v1/user/me")
      .send({ university: "School" })
      .expect(401);
    await http()
      .patch(`/api/v1/posts/${post.id}`)
      .send({ locationName: "Place" })
      .expect(401);
    await ds
      .getRepository(PostEntity)
      .update(post.id, { status: PostStatus.HIDDEN });
    await patchPost(post.id, { locationName: "Place" }).expect(400);
    await ds.getRepository(UserEntity).update(owner.id, { isLocked: true });
    try {
      await patchUser({ university: "School" }).expect(401);
    } finally {
      await ds.getRepository(UserEntity).update(owner.id, { isLocked: false });
    }
  });

  it("allows the new fields through both service allowlists and CASL field policies", async () => {
    const context = app
      .get(AuthorizationService)
      .createAuthenticatedContext(owner);
    const post = await app
      .get(PostsService)
      .create({ ...body(), locationName: "Cổng trường" }, context);
    expect(
      (
        await app
          .get(PostsService)
          .update(post.id, { locationName: null }, context)
      ).locationName,
    ).toBeNull();
    expect(
      (
        await app
          .get(UserService)
          .updateMyProfile(
            Object.assign(new UpdateUserDto(), { university: "Trường mới" }),
            context,
          )
      ).university,
    ).toBe("Trường mới");
  });

  it("documents nullable optional strings on registration, profile and post DTOs", () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().build(),
    );
    for (const [name, field, maxLength] of [
      ["RegisterUserDto", "university", 150],
      ["UpdateUserDto", "university", 150],
      ["CreatePostDto", "locationName", 255],
      ["UpdatePostDto", "locationName", 255],
    ] as const) {
      const schema = document.components!.schemas![name];
      if (!("properties" in schema))
        throw new Error(`Missing schema properties: ${name}`);
      expect(schema.properties![field]).toMatchObject({
        type: "string",
        nullable: true,
        minLength: 1,
        maxLength,
      });
      expect(schema.required ?? []).not.toContain(field);
    }
  });
});
