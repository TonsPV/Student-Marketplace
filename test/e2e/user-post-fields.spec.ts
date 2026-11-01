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
import { PostImageEntity } from "../../src/modules/post-images/post-image.entity";
import { ReviewEntity } from "../../src/modules/reviews/review.entity";
import { UserService } from "../../src/modules/user/user.service";
import {
  createTestDataSource,
  initializeTestDatabase,
  disposeTestDatabase,
  ownedTestSchema,
  testDatabaseEnv,
} from "../integration/database";
import {
  createReadyTestUser as createTestUser,
  createTestCategory,
  createTestPost,
} from "../integration/fixtures";

describe("university and locationName API contracts", () => {
  let app: INestApplication, ds: DataSource, jwt: JwtService;
  let owner: UserEntity,
    outsider: UserEntity,
    admin: UserEntity,
    categoryId: string;

  it("requires location before business APIs, then accepts the same JWT after saving", async () => {
    const incomplete = await createTestUser(ds, { location: null });
    const headers = auth(incomplete);
    const me = await http().get("/api/v1/user/me").set(headers).expect(200);
    expect(me.body.data.hasLocation).toBe(false);
    const blocked = await http()
      .post("/api/v1/posts")
      .set(headers)
      .send(body())
      .expect(403);
    expect(blocked.body.code).toBe("LOCATION_REQUIRED");
    await http().get("/api/v1/conversations").set(headers).expect(403);
    await http()
      .post("/api/v1/realtime/socket-ticket")
      .set(headers)
      .expect(403);
    await http()
      .patch("/api/v1/user/me/location")
      .set(headers)
      .send({ latitude: 10.77, longitude: 106.7 })
      .expect(200);
    const ready = await http().get("/api/v1/user/me").set(headers).expect(200);
    expect(ready.body.data.hasLocation).toBe(true);
    await http().post("/api/v1/posts").set(headers).send(body()).expect(201);
    await http().get("/api/v1/conversations").set(headers).expect(200);
    await http()
      .post("/api/v1/realtime/socket-ticket")
      .set(headers)
      .expect(201);
  });
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

  beforeEach(async () => {
    // Each field scenario gets its own quota instead of sharing accumulated posts.
    owner = await createTestUser(ds);
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

  it("searches without Vietnamese accents while preserving the HTTP response contract", async () => {
    const post = await createTestPost(ds, owner.id, categoryId, {
      title: "Điện thoại thử nghiệm",
      description: "Đồ dùng còn mới",
      locationName: "Thư viện",
    });
    for (const q of [
      "dien thoai thu nghiem",
      "ĐIỆN THOẠI THỬ NGHIỆM",
    ]) {
      const response = await http()
        .get("/api/v1/posts/search")
        .query({ q, sellerId: owner.id, categoryId })
        .expect(200);
      expect(Object.keys(response.body).sort()).toEqual([
        "data",
        "message",
        "statusCode",
      ]);
      expect(response.body).toMatchObject({
        statusCode: 200,
        message: "Posts found successfully!",
        data: { meta: { page: 1, limit: 20, total: 1, totalPages: 1 } },
      });
      expect(response.body.data.items).toHaveLength(1);
      expect(response.body.data.items[0]).toMatchObject({
        id: post.id,
        title: post.title,
        description: post.description,
        locationName: "Thư viện",
        distance: null,
      });
    }
  });

  it("finds the math book using separated keywords and requires every keyword", async () => {
    const post = await createTestPost(ds, owner.id, categoryId, {
      title: "Sách bài tập Toán 3 có lời giải",
      description: "Dành cho học sinh",
    });
    for (const q of ["sach toan 3", "3 TOÁN sách", "  sach   toan 3  "]) {
      const response = await http()
        .get("/api/v1/posts/search")
        .query({ q, sellerId: owner.id, categoryId })
        .expect(200);
      expect(
        response.body.data.items.map((item: { id: string }) => item.id),
      ).toEqual([post.id]);
      expect(response.body.data.meta).toMatchObject({
        total: 1,
        totalPages: 1,
      });
    }
    for (const q of ["sach toan 9", "sach toann 3", "danh cho hoc sinh", "sach hoc sinh"]) {
      const response = await http()
        .get("/api/v1/posts/search")
        .query({ q, sellerId: owner.id, categoryId })
        .expect(200);
      expect(response.body.data.items).toEqual([]);
      expect(response.body.data.meta.total).toBe(0);
    }
  });

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
    expect(detail.body.data.location).toEqual({
      latitude: 10.77,
      longitude: 106.7,
    });
    expect(detail.body.data.seller).toHaveProperty("university", null);
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
      expect(
        response.body.data.items.find(
          (item: { id: string }) => item.id === post.id,
        ).location,
      ).toEqual({ latitude: 10.77, longitude: 106.7 });
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

  it("creates and updates named coordinates while DB keeps GeoJSON; null clears location", async () => {
    const location = { latitude: 10.77, longitude: 106.7 };
    const created = await http()
      .post("/api/v1/posts")
      .set(auth(owner))
      .send({ ...body(), location })
      .expect(201);
    const id = created.body.data.id;
    expect(created.body.data.location).toEqual(location);
    expect(
      (await ds.getRepository(PostEntity).findOneByOrFail({ id })).location
        ?.coordinates,
    ).toEqual([106.7, 10.77]);
    const next = { latitude: 0, longitude: 0 };
    expect(
      (await patchPost(id, { location: next }).expect(200)).body.data.location,
    ).toEqual(next);
    expect(
      (await patchPost(id, { title: "Giữ nguyên vị trí" }).expect(200)).body
        .data.location,
    ).toEqual(next);
    for (const invalid of [
      { latitude: 91, longitude: 106 },
      { latitude: 10, longitude: 181 },
      { latitude: "10", longitude: 106 },
      { latitude: 10 },
      { type: "Point", coordinates: [106, 10] },
      { ...next, extra: true },
    ]) {
      await patchPost(id, { location: invalid }).expect(400);
      await http()
        .post("/api/v1/posts")
        .set(auth(owner))
        .send({ ...body(), location: invalid })
        .expect(400);
    }
    expect(
      (await patchPost(id, { location: null }).expect(200)).body.data.location,
    ).toBeNull();
    expect(
      (await ds.getRepository(PostEntity).findOneByOrFail({ id })).location,
    ).toBeNull();
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

  it("serves sold detail/images, real seller aggregates, and filters related posts before pagination", async () => {
    const seller = await createTestUser(ds, {
      university: "ĐH Công Nghệ Thông Tin",
      phone: "0912345678",
    });
    const active = await createTestPost(ds, seller.id, categoryId, {
      location: { type: "Point", coordinates: [106.8, 10.8] },
      locationName: "KTX Khu B",
    });
    const related = await createTestPost(ds, seller.id, categoryId);
    const sold = await createTestPost(ds, seller.id, categoryId, {
      status: PostStatus.SOLD,
    });
    const hidden = await createTestPost(ds, seller.id, categoryId, {
      status: PostStatus.HIDDEN,
    });
    const deleted = await createTestPost(ds, seller.id, categoryId, {
      status: PostStatus.SOLD,
    });
    await ds.getRepository(PostEntity).softDelete(deleted.id);
    for (const [post, rating] of [
      [active, 4],
      [sold, 5],
      [hidden, 3],
      [deleted, 1],
    ] as const) {
      await ds.getRepository(ReviewEntity).save({
        id: randomUUID(),
        postId: post.id,
        reviewerId: outsider.id,
        rating,
      });
    }
    const deletedReview = await ds.getRepository(ReviewEntity).save({
      id: randomUUID(),
      postId: related.id,
      reviewerId: outsider.id,
      rating: 2,
    });
    await ds.getRepository(ReviewEntity).softDelete(deletedReview.id);
    const imageIds = [randomUUID(), randomUUID()].sort();
    for (const id of imageIds)
      await ds.getRepository(PostImageEntity).save({
        id,
        postId: sold.id,
        url: `https://images.example.test/${id}.jpg`,
      });
    for (const post of [active, sold]) {
      for (const headers of [{}, auth(outsider)]) {
        const result = await http()
          .get(`/api/v1/posts/${post.id}`)
          .set(headers)
          .expect(200);
        expect(result.body.data.seller).toMatchObject({
          id: seller.id,
          university: seller.university,
          ratingAverage: 4.5,
          reviewCount: 2,
          reputationLevel: "INSUFFICIENT_DATA",
          soldCount: 1,
        });
        expect(result.body.data.seller.createdAt).toBeTruthy();
        expect(Object.keys(result.body.data.seller)).not.toEqual(
          expect.arrayContaining([
            "email",
            "phone",
            "password",
            "isAdmin",
            "location",
            "avatarStorageKey",
          ]),
        );
        for (const key of [
          "email",
          "phone",
          "password",
          "isAdmin",
          "location",
          "avatarStorageKey",
        ])
          expect(result.body.data.seller).not.toHaveProperty(key);
      }
    }
    const images = await http()
      .get(`/api/v1/posts/${sold.id}/images`)
      .expect(200);
    expect(images.body.data.map((image: { id: string }) => image.id)).toEqual(
      imageIds,
    );
    expect(
      images.body.data.every((image: object) => !("storageKey" in image)),
    ).toBe(true);
    for (const post of [hidden, deleted]) {
      await http().get(`/api/v1/posts/${post.id}`).expect(404);
      await http().get(`/api/v1/posts/${post.id}/images`).expect(404);
    }
    await http()
      .post("/api/v1/favorites")
      .set(auth(outsider))
      .send({ postId: sold.id })
      .expect(404);
    await http()
      .post("/api/v1/conversations")
      .set(auth(outsider))
      .send({ postId: sold.id })
      .expect(404);
    const search = await http()
      .get(
        `/api/v1/posts/search?sellerId=${seller.id}&excludePostId=${active.id}&limit=1`,
      )
      .expect(200);
    expect(
      search.body.data.items.map((post: { id: string }) => post.id),
    ).toEqual([related.id]);
    expect(search.body.data.meta).toMatchObject({ total: 1, totalPages: 1 });
    await http().get("/api/v1/posts/search?sellerId=invalid").expect(400);
    await http().get("/api/v1/posts/search?excludePostId=invalid").expect(400);
    const fresh = await createTestPost(
      ds,
      (await createTestUser(ds)).id,
      categoryId,
    );
    const noReviews = await http().get(`/api/v1/posts/${fresh.id}`).expect(200);
    expect(noReviews.body.data.seller).toMatchObject({
      ratingAverage: null,
      reviewCount: 0,
      reputationLevel: "UNRATED",
      soldCount: 0,
    });
  });

  it("enforces public review visibility for detail, post lists, seller lists, and aggregates", async () => {
    const seller = await createTestUser(ds);
    const [active, sold, hidden, deletedPost, deletedReviewPost] =
      await Promise.all([
        createTestPost(ds, seller.id, categoryId),
        createTestPost(ds, seller.id, categoryId, { status: PostStatus.SOLD }),
        createTestPost(ds, seller.id, categoryId, {
          status: PostStatus.HIDDEN,
        }),
        createTestPost(ds, seller.id, categoryId, { status: PostStatus.SOLD }),
        createTestPost(ds, seller.id, categoryId),
      ]);
    await ds.getRepository(PostEntity).softDelete(deletedPost.id);
    const reviews = await Promise.all(
      [
        [active, 4],
        [sold, 5],
        [hidden, 3],
        [deletedPost, 1],
      ].map(async ([post, rating]) =>
        ds.getRepository(ReviewEntity).save({
          id: randomUUID(),
          postId: (post as PostEntity).id,
          reviewerId: outsider.id,
          rating: rating as number,
        }),
      ),
    );
    const deletedReview = await ds.getRepository(ReviewEntity).save({
      id: randomUUID(),
      postId: deletedReviewPost.id,
      reviewerId: admin.id,
      rating: 2,
    });
    await ds.getRepository(ReviewEntity).softDelete(deletedReview.id);

    const visibleIds = [reviews[0].id, reviews[1].id];
    for (const [id, expected] of [
      [reviews[0].id, 200],
      [reviews[1].id, 200],
      [reviews[2].id, 404],
      [reviews[3].id, 404],
      [deletedReview.id, 404],
    ] as const) {
      const response = await http()
        .get(`/api/v1/reviews/${id}`)
        .expect(expected);
      if (expected === 200) {
        expect(response.body.data.id).toBe(id);
        expect(response.body.data).not.toHaveProperty("oldRating");
        expect(response.body.data).not.toHaveProperty("newComment");
      }
    }

    for (const [post, expectedIds, status] of [
      [active, [reviews[0].id], 200],
      [sold, [reviews[1].id], 200],
      [hidden, [], 404],
      [deletedPost, [], 404],
      [deletedReviewPost, [], 200],
    ] as const) {
      const response = await http()
        .get(`/api/v1/posts/${post.id}/reviews`)
        .expect(status);
      if (status === 200) {
        expect(
          response.body.data.items.map((item: ReviewEntity) => item.id),
        ).toEqual(expectedIds);
        expect(response.body.data.items).not.toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: hidden.id }),
            expect.objectContaining({ id: deletedPost.id }),
          ]),
        );
      }
    }

    const sellerReviews = await http()
      .get(`/api/v1/users/${seller.id}/reviews`)
      .expect(200);
    const sellerReviewIds = sellerReviews.body.data.items.map(
      (item: ReviewEntity) => item.id,
    );
    expect(sellerReviewIds).toHaveLength(2);
    expect(sellerReviewIds).toEqual(expect.arrayContaining(visibleIds));
    expect(sellerReviews.body.data.meta.total).toBe(2);

    const profile = await http()
      .get(`/api/v1/user/${seller.id}/public`)
      .expect(200);
    expect(profile.body.data).toMatchObject({
      ratingAverage: 4.5,
      reviewCount: 2,
      reputationLevel: "INSUFFICIENT_DATA",
    });

    await http().get("/api/v1/reviews/").expect(404);
  });

  it("serves public profiles and active/sold posts without private account data", async () => {
    const seller = await createTestUser(ds, {
      university: "UIT",
      phone: "0912345678",
    });
    await ds.getRepository(UserEntity).update(seller.id, {
      avatarStorageKey: `avatars/${seller.id}/${randomUUID()}.jpg`,
    });
    const active = await createTestPost(ds, seller.id, categoryId, {
      createdAt: new Date("2026-10-12T01:00:00Z"),
    });
    const sold = await createTestPost(ds, seller.id, categoryId, {
      status: PostStatus.SOLD,
      createdAt: new Date("2026-10-11T01:00:00Z"),
    });
    const hidden = await createTestPost(ds, seller.id, categoryId, {
      status: PostStatus.HIDDEN,
    });
    const deleted = await createTestPost(ds, seller.id, categoryId, {
      status: PostStatus.SOLD,
    });
    await ds.getRepository(PostEntity).softDelete(deleted.id);
    for (const [post, rating] of [
      [active, 4],
      [sold, 5],
      [hidden, 3],
      [deleted, 1],
    ] as const) {
      await ds.getRepository(ReviewEntity).save({
        id: randomUUID(),
        postId: post.id,
        reviewerId: outsider.id,
        rating,
      });
    }
    for (const headers of [{}, auth(outsider)]) {
      const profile = (
        await http()
          .get(`/api/v1/user/${seller.id}/public`)
          .set(headers)
          .expect(200)
      ).body.data;
      expect(profile).toMatchObject({
        id: seller.id,
        fullName: seller.fullName,
        university: "UIT",
        ratingAverage: 4.5,
        reviewCount: 2,
        reputationLevel: "INSUFFICIENT_DATA",
        activeCount: 1,
        soldCount: 1,
      });
      expect(profile.avatarUrl).toMatch(/^https:/);
      expect(profile.avatarUrlExpiresAt).toBeTruthy();
      for (const key of [
        "email",
        "phone",
        "password",
        "isAdmin",
        "isLocked",
        "location",
        "avatarStorageKey",
        "deletedAt",
      ])
        expect(profile).not.toHaveProperty(key);
      const first = (
        await http()
          .get(`/api/v1/user/${seller.id}/posts?limit=1`)
          .set(headers)
          .expect(200)
      ).body.data;
      expect(first.items.map((post: PostEntity) => post.id)).toEqual([
        active.id,
      ]);
      expect(first.meta).toMatchObject({
        page: 1,
        limit: 1,
        total: 2,
        totalPages: 2,
      });
      expect(first.items[0].category).toMatchObject({ id: categoryId });
      expect(first.items[0]).not.toHaveProperty("seller");
      const second = (
        await http()
          .get(`/api/v1/user/${seller.id}/posts?limit=1&page=2`)
          .set(headers)
          .expect(200)
      ).body.data;
      expect(second.items.map((post: PostEntity) => post.id)).toEqual([
        sold.id,
      ]);
      for (const [status, id] of [
        ["active", active.id],
        ["sold", sold.id],
      ]) {
        const result = (
          await http()
            .get(`/api/v1/user/${seller.id}/posts?status=${status}`)
            .set(headers)
            .expect(200)
        ).body.data;
        expect(result.items.map((post: PostEntity) => post.id)).toEqual([id]);
        expect(result.meta.total).toBe(1);
      }
    }
    for (const query of [
      "status=hidden",
      "status=invalid",
      "page=0",
      "limit=0",
      "limit=101",
    ])
      await http().get(`/api/v1/user/${seller.id}/posts?${query}`).expect(400);
    const empty = await createTestUser(ds);
    expect(
      (await http().get(`/api/v1/user/${empty.id}/public`).expect(200)).body
        .data,
    ).toMatchObject({
      ratingAverage: null,
      reviewCount: 0,
      reputationLevel: "UNRATED",
      activeCount: 0,
      soldCount: 0,
    });
    expect(
      (await http().get(`/api/v1/user/${empty.id}/posts`).expect(200)).body
        .data,
    ).toMatchObject({ items: [], meta: { total: 0, totalPages: 0 } });
    const locked = await createTestUser(ds, { isLocked: true });
    const removed = await createTestUser(ds);
    await ds.getRepository(UserEntity).softDelete(removed.id);
    for (const id of [locked.id, removed.id, randomUUID()])
      for (const resource of ["public", "posts"])
        await http().get(`/api/v1/user/${id}/${resource}`).expect(404);
    for (const resource of ["public", "posts"])
      await http().get(`/api/v1/user/invalid/${resource}`).expect(400);
  });

  it("keeps deleted posts owner-only and restores the original active/sold/hidden status", async () => {
    const seller = await createTestUser(ds);
    const posts = await Promise.all(
      [PostStatus.ACTIVE, PostStatus.SOLD, PostStatus.HIDDEN].map((status) =>
        createTestPost(ds, seller.id, categoryId, { status }),
      ),
    );
    const foreign = await createTestPost(ds, outsider.id, categoryId);
    await ds.getRepository(PostEntity).softDelete(foreign.id);
    for (const post of posts) {
      await http().delete(`/api/v1/posts/${post.id}`).expect(401);
      for (const user of [outsider, admin])
        await http()
          .delete(`/api/v1/posts/${post.id}`)
          .set(auth(user))
          .expect(403);
      await http()
        .delete(`/api/v1/posts/${post.id}`)
        .set(auth(seller))
        .expect(200);
      await http().get(`/api/v1/posts/${post.id}`).expect(404);
      await http().get(`/api/v1/posts/${post.id}/images`).expect(404);
      await http()
        .delete(`/api/v1/posts/${post.id}`)
        .set(auth(seller))
        .expect(404);
    }
    await http().get("/api/v1/posts/me?deleted=true").expect(401);
    const first = (
      await http()
        .get("/api/v1/posts/me?deleted=true&limit=1")
        .set(auth(seller))
        .expect(200)
    ).body.data;
    expect(first.items).toHaveLength(1);
    expect(first.items[0].sellerId).toBe(seller.id);
    expect(first.items[0].deletedAt).toBeTruthy();
    expect(first.meta).toMatchObject({ total: 3, totalPages: 3 });
    const all = (
      await http()
        .get("/api/v1/posts/me?deleted=true")
        .set(auth(seller))
        .expect(200)
    ).body.data;
    expect(all.items.map((post: PostEntity) => post.id).sort()).toEqual(
      posts.map((post) => post.id).sort(),
    );
    expect(
      (
        await http()
          .get("/api/v1/posts/me?deleted=false")
          .set(auth(seller))
          .expect(200)
      ).body.data.items,
    ).toEqual([]);
    await http()
      .get("/api/v1/posts/me?deleted=1")
      .set(auth(seller))
      .expect(400);
    await http().get("/api/v1/posts?deleted=true").expect(400);
    for (const post of posts) {
      await http().patch(`/api/v1/posts/${post.id}/restore`).expect(401);
      for (const user of [outsider, admin])
        await http()
          .patch(`/api/v1/posts/${post.id}/restore`)
          .set(auth(user))
          .expect(403);
      const restored = (
        await http()
          .patch(`/api/v1/posts/${post.id}/restore`)
          .set(auth(seller))
          .expect(200)
      ).body.data;
      expect(restored.status).toBe(post.status);
      expect(restored.deletedAt).toBeNull();
      await http()
        .get(`/api/v1/posts/${post.id}`)
        .expect(post.status === PostStatus.HIDDEN ? 404 : 200);
    }
    const deleted = (
      await http()
        .get("/api/v1/posts/me?deleted=true")
        .set(auth(seller))
        .expect(200)
    ).body.data;
    expect(deleted).toMatchObject({ items: [], meta: { total: 0 } });
    expect(
      (await http().get("/api/v1/posts/me").set(auth(seller)).expect(200)).body
        .data.meta.total,
    ).toBe(3);
  });

  it("filters own active/sold/hidden posts before pagination without leaking another seller", async () => {
    const seller = await createTestUser(ds);
    const entries = await Promise.all(
      [
        PostStatus.ACTIVE,
        PostStatus.ACTIVE,
        PostStatus.SOLD,
        PostStatus.HIDDEN,
      ].map((status) => createTestPost(ds, seller.id, categoryId, { status })),
    );
    const removed = await createTestPost(ds, seller.id, categoryId, {
      status: PostStatus.HIDDEN,
    });
    await ds.getRepository(PostEntity).softDelete(removed.id);
    await createTestPost(ds, outsider.id, categoryId, {
      status: PostStatus.HIDDEN,
    });
    for (const status of [
      PostStatus.ACTIVE,
      PostStatus.SOLD,
      PostStatus.HIDDEN,
    ]) {
      await http().get(`/api/v1/posts/me?status=${status}`).expect(401);
      const result = (
        await http()
          .get(`/api/v1/posts/me?status=${status}&limit=1`)
          .set(auth(seller))
          .expect(200)
      ).body.data;
      const expected = entries.filter((post) => post.status === status);
      expect(result.meta).toMatchObject({
        total: expected.length,
        totalPages: expected.length,
      });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        sellerId: seller.id,
        status,
        deletedAt: null,
      });
      if (expected.length > 1) {
        const second = (
          await http()
            .get(`/api/v1/posts/me?status=${status}&limit=1&page=2`)
            .set(auth(seller))
            .expect(200)
        ).body.data;
        expect(second.items[0].id).not.toBe(result.items[0].id);
      }
    }
    const deleted = (
      await http()
        .get("/api/v1/posts/me?deleted=true&status=hidden")
        .set(auth(seller))
        .expect(200)
    ).body.data;
    expect(deleted.items.map((post: PostEntity) => post.id)).toEqual([
      removed.id,
    ]);
    for (const status of ["invalid", "", "ACTIVE"])
      await http()
        .get(`/api/v1/posts/me?status=${status}`)
        .set(auth(seller))
        .expect(400);
    await http().get("/api/v1/posts?status=hidden").expect(400);
    await http()
      .get(`/api/v1/user/${seller.id}/posts?status=hidden`)
      .expect(400);
  });

  it("does not expose seller or post internal fields in purchased posts", async () => {
    const buyer = await createTestUser(ds);
    const seller = await createTestUser(ds, {
      avatarUrl: "https://images.example.test/avatar.jpg",
    });
    const purchased = await createTestPost(ds, seller.id, categoryId, {
      status: PostStatus.SOLD,
      buyerId: buyer.id,
      soldAt: new Date(),
    });

    const response = await http()
      .get("/api/v1/posts/purchased")
      .set(auth(buyer))
      .expect(200);
    const item = response.body.data.items.find(
      (entry: { id: string }) => entry.id === purchased.id,
    );

    expect(item).toBeDefined();
    expect(item).toMatchObject({
      id: purchased.id,
      soldAt: expect.any(String),
      reviewDeadline: expect.any(String),
      canReview: true,
      reviewStatus: "NOT_REVIEWED",
      review: null,
      seller: {
        id: seller.id,
        fullName: seller.fullName,
        avatarUrl: seller.avatarUrl,
      },
    });
    expect(item.seller).not.toHaveProperty("password");
    expect(item.seller).not.toHaveProperty("avatarStorageKey");
    expect(item.seller).not.toHaveProperty("deletedAt");
    expect(item.seller).not.toHaveProperty("isAdmin");
    expect(item.seller).not.toHaveProperty("isLocked");
    expect(item).not.toHaveProperty("deletedAt");
    expect(item).not.toHaveProperty("buyerId");
  });

  it("enforces quota and expiry through HTTP, keeps expired detail private and renews once for free", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const created = await http().post("/api/v1/posts").set(auth(owner)).send(body()).expect(201);
      ids.push(created.body.data.id);
    }
    const full = await http().post("/api/v1/posts").set(auth(owner)).send(body()).expect(409);
    expect(full.body.code).toBe("POST_QUOTA_EXCEEDED");
    const id = ids[0];
    await ds.getRepository(PostEntity).update(id, {
      publishedAt: new Date(Date.now() - 15 * 86400000),
      expiresAt: new Date(Date.now() - 86400000),
    });
    await http().get(`/api/v1/posts/${id}`).expect(404);
    await http().get(`/api/v1/posts/${id}/images`).expect(404);
    const detail = await http().get(`/api/v1/posts/me/${id}`).set(auth(owner)).expect(200);
    expect(detail.body.data.status).toBe("expired");
    await http().get(`/api/v1/posts/${id}/images/me`).set(auth(owner)).expect(200);
    await http().get(`/api/v1/posts/me/${id}`).set(auth(outsider)).expect(404);
    await http().post(`/api/v1/posts/${id}/renew`).expect(401);
    await http().post(`/api/v1/posts/${id}/renew`).set(auth(outsider)).expect(403);
    const quota = await http().get("/api/v1/posts/me/quota").set(auth(owner)).expect(200);
    expect(quota.body.data).toMatchObject({ used: 4, remaining: 1 });
    const renewed = await http().post(`/api/v1/posts/${id}/renew`).set(auth(owner)).expect(201);
    expect(renewed.body.data).toMatchObject({ status: "active", renewalCount: 1, freeRenewalAvailable: false });
    const history = await http().get(`/api/v1/posts/${id}/renewals`).set(auth(owner)).expect(200);
    expect(history.body.data.items).toHaveLength(1);
    expect(history.body.data.items[0]).toMatchObject({ renewalNumber: 1, kind: "free" });
    expect(history.body.data.items[0]).not.toHaveProperty("paymentReference");
    await ds.getRepository(PostEntity).update(id, {
      publishedAt: new Date(Date.now() - 15 * 86400000),
      expiresAt: new Date(Date.now() - 86400000),
    });
    const paid = await http().post(`/api/v1/posts/${id}/renew`).set(auth(owner)).expect(409);
    expect(paid.body.code).toBe("POST_PAYMENT_REQUIRED");
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
