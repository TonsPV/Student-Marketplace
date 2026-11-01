import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { DataSource } from "typeorm";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { configureApplication } from "../../src/main";
import { UserEntity } from "../../src/modules/user/user.entity";
import { PostCondition, PostEntity } from "../../src/modules/posts/post.entity";
import { AuthorizationService } from "../../src/modules/authorization/authorization.service";
import { ModerationService } from "../../src/modules/moderation/moderation.service";
import { PostingRestrictionType } from "../../src/modules/moderation/posting-restriction.rules";
import {
  createTestDataSource,
  disposeTestDatabase,
  initializeTestDatabase,
  ownedTestSchema,
  testDatabaseEnv,
} from "../integration/database";
import {
  createReadyTestUser as createTestUser,
  createTestCategory,
} from "../integration/fixtures";

describe("posting restriction over HTTP", () => {
  let app: INestApplication, ds: DataSource, jwt: JwtService;
  let admin: UserEntity, categoryId: string;

  const http = () => request(app.getHttpServer());
  const auth = (user: UserEntity) => ({
    Authorization: `Bearer ${jwt.sign({ id: user.id }, { expiresIn: "15m" })}`,
  });
  const body = () => ({
    categoryId,
    title: "Sách Giải tích 1",
    description: "Sách còn mới, có ghi chú bằng bút chì.",
    price: "50000",
    condition: PostCondition.LIKE_NEW,
  });
  // This suite targets posting enforcement, so moderation setup goes through
  // the service directly. The admin HTTP API is covered by
  // admin-moderation.spec.ts.
  const adminCtx = () =>
    app.get(AuthorizationService).createAuthenticatedContext({
      id: admin.id,
      email: admin.email,
      fullName: admin.fullName,
      isAdmin: true,
      hasLocation: true,
    });
  const moderation = () => app.get(ModerationService);
  const restrict = (user: UserEntity) =>
    moderation().createPostingRestriction(adminCtx(), {
      userId: user.id,
      type: PostingRestrictionType.TEMPORARY,
      reason: "Đăng spam",
      expiresAt: new Date(Date.now() + 3_600_000),
    });

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
      SEED_ADMIN_EMAIL: "restriction-test-admin@example.com",
      SEED_ADMIN_NAME: "Test Admin",
      SEED_ADMIN_PASSWORD: "test-admin-password",
      SEED_ADMIN_PHONE: "1234567890",
    });
    ds = createTestDataSource();
    await initializeTestDatabase(ds);
    process.env.POSTGRES_SCHEMA = ownedTestSchema(ds);
    admin = await createTestUser(ds, { isAdmin: true });
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

  it("blocks POST /posts with POSTING_RESTRICTED but leaves the account usable", async () => {
    const [user, seller] = [await createTestUser(ds), await createTestUser(ds)];
    const restriction = await restrict(user);
    const count = () =>
      ds.getRepository(PostEntity).count({ where: { sellerId: user.id } });
    const before = await count();

    const blocked = await http()
      .post("/api/v1/posts")
      .set(auth(user))
      .send(body())
      .expect(403);
    expect(blocked.body).toMatchObject({
      code: "POSTING_RESTRICTED",
      restriction: {
        type: "TEMPORARY",
        reason: "Đăng spam",
        expiresAt: restriction.expiresAt!.toISOString(),
      },
    });
    expect(await count()).toBe(before);

    // JWT auth, reads, messaging and buying flows are unaffected.
    await http().get("/api/v1/user/me").set(auth(user)).expect(200);
    await http().get("/api/v1/posts").set(auth(user)).expect(200);
    await http().get("/api/v1/notifications").set(auth(user)).expect(200);
    await http().get("/api/v1/conversations").set(auth(user)).expect(200);
    const listing = await http()
      .post("/api/v1/posts")
      .set(auth(seller))
      .send(body())
      .expect(201);
    await http()
      .post("/api/v1/conversations")
      .set(auth(user))
      .send({ postId: listing.body.data.id })
      .expect(201);
    expect(
      (await ds.getRepository(UserEntity).findOneByOrFail({ id: user.id }))
        .isLocked,
    ).toBe(false);
  });

  it("a warning alone never blocks posting", async () => {
    const user = await createTestUser(ds);
    await moderation().issueWarning(adminCtx(), {
      userId: user.id,
      reason: "Ngôn từ không phù hợp",
    });
    await http().post("/api/v1/posts").set(auth(user)).send(body()).expect(201);
  });

  it("exposes only the authenticated user's status and privacy-safe restriction history", async () => {
    const user = await createTestUser(ds);
    const active = await restrict(user);

    const status = await http()
      .get("/api/v1/user/me/moderation/status")
      .set(auth(user))
      .expect(200);
    expect(status.body.data).toMatchObject({
      isRestricted: true,
      canCreatePost: false,
    });
    expect(status.body.data.activeRestrictions.length).toBeGreaterThan(0);
    expect(status.body.data.scheduledRestrictions).toEqual([]);
    expect(status.body.data.activeRestrictions[0]).not.toHaveProperty(
      "sourceReportId",
    );
    expect(status.body.data.activeRestrictions[0]).not.toHaveProperty(
      "issuedBy",
    );

    const history = await http()
      .get("/api/v1/user/me/moderation/restrictions?page=1&limit=10")
      .set(auth(user))
      .expect(200);
    expect(history.body.data.items.length).toBeGreaterThan(0);
    expect(
      history.body.data.items.map((item: { id: string }) => item.id),
    ).toContain(active.id);

    await http().get("/api/v1/user/me/moderation/status").expect(401);
  });

  it("restore is blocked while restricted and allowed after lift", async () => {
    const user = await createTestUser(ds);
    const created = await http()
      .post("/api/v1/posts")
      .set(auth(user))
      .send(body())
      .expect(201);
    const id = created.body.data.id as string;
    await http().delete(`/api/v1/posts/${id}`).set(auth(user)).expect(200);
    const restriction = await restrict(user);

    const blocked = await http()
      .patch(`/api/v1/posts/${id}/restore`)
      .set(auth(user))
      .expect(403);
    expect(blocked.body.code).toBe("POSTING_RESTRICTED");

    await moderation().liftPostingRestriction(adminCtx(), restriction.id, "ok");
    await http()
      .patch(`/api/v1/posts/${id}/restore`)
      .set(auth(user))
      .expect(200);
    await http().post("/api/v1/posts").set(auth(user)).send(body()).expect(201);
  });
});
