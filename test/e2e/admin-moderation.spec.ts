import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { DataSource } from "typeorm";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { configureApplication } from "../../src/main";
import { UserEntity } from "../../src/modules/user/user.entity";
import { PostingRestrictionEntity } from "../../src/modules/moderation/posting-restriction.entity";
import { UserWarningEntity } from "../../src/modules/moderation/user-warning.entity";
import { PostingRestrictionType } from "../../src/modules/moderation/posting-restriction.rules";
import {
  createTestDataSource,
  disposeTestDatabase,
  initializeTestDatabase,
  ownedTestSchema,
  testDatabaseEnv,
} from "../integration/database";
import { createReadyTestUser as createTestUser } from "../integration/fixtures";

const BASE = "/api/v1/admin/moderation";
const HOUR = 3_600_000;
const { TEMPORARY, PERMANENT } = PostingRestrictionType;

describe("admin moderation API over HTTP (Phase 2)", () => {
  let app: INestApplication, ds: DataSource, jwt: JwtService;
  let admin: UserEntity, otherAdmin: UserEntity;

  const http = () => request(app.getHttpServer());
  const auth = (user: UserEntity) => ({
    Authorization: `Bearer ${jwt.sign({ id: user.id }, { expiresIn: "15m" })}`,
  });
  const inHours = (h: number) => new Date(Date.now() + h * HOUR).toISOString();
  /** Nest returns string[] for DTO errors and a string for service errors. */
  const messages = (res: { body: unknown }): string[] => {
    const m = (res.body as { message?: unknown }).message;
    return Array.isArray(m) ? m.map(String) : [String(m)];
  };
  const createRestriction = (actor: UserEntity, payload: object) =>
    http().post(`${BASE}/restrictions`).set(auth(actor)).send(payload);
  const temporary = (userId: string, extra: object = {}) => ({
    userId,
    type: TEMPORARY,
    reason: "Đăng spam",
    expiresAt: inHours(1),
    ...extra,
  });
  const lift = (actor: UserEntity, id: string, liftReason = "Kháng cáo") =>
    http()
      .patch(`${BASE}/restrictions/${id}/lift`)
      .set(auth(actor))
      .send({ liftReason });

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
      SEED_ADMIN_EMAIL: "moderation-api-test-admin@example.com",
      SEED_ADMIN_NAME: "Test Admin",
      SEED_ADMIN_PASSWORD: "test-admin-password",
      SEED_ADMIN_PHONE: "1234567890",
    });
    ds = createTestDataSource();
    await initializeTestDatabase(ds);
    process.env.POSTGRES_SCHEMA = ownedTestSchema(ds);
    admin = await createTestUser(ds, { isAdmin: true, fullName: "Admin A" });
    otherAdmin = await createTestUser(ds, { isAdmin: true, fullName: "Admin B" });
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

  it("401 without a token, 403 for regular users on every route", async () => {
    const user = await createTestUser(ds);
    const id = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const routes = [
      () => http().get(`${BASE}/warnings`),
      () => http().post(`${BASE}/warnings`).send({ userId: id, reason: "x" }),
      () => http().get(`${BASE}/users/${id}/warnings`),
      () => http().get(`${BASE}/restrictions`),
      () => http().post(`${BASE}/restrictions`).send(temporary(id)),
      () => http().get(`${BASE}/users/${id}/restrictions`),
      () => http().get(`${BASE}/restrictions/${id}`),
      () =>
        http()
          .patch(`${BASE}/restrictions/${id}/lift`)
          .send({ liftReason: "x" }),
    ];
    for (const route of routes) {
      await route().expect(401);
      await route().set(auth(user)).expect(403);
    }
  });

  it("D5: user summaries are { id, fullName } only, never email", async () => {
    const target = await createTestUser(ds, { fullName: "Nguyễn Văn A" });
    const warning = await http()
      .post(`${BASE}/warnings`)
      .set(auth(admin))
      .send({ userId: target.id, reason: "  Ngôn từ không phù hợp  " })
      .expect(201);
    expect(warning.body.data).toMatchObject({
      userId: target.id,
      reason: "Ngôn từ không phù hợp",
      user: { id: target.id, fullName: "Nguyễn Văn A" },
      issuedBy: { id: admin.id, fullName: "Admin A" },
    });
    expect(Object.keys(warning.body.data.user).sort()).toEqual([
      "fullName",
      "id",
    ]);

    const restriction = await createRestriction(admin, temporary(target.id))
      .expect(201);
    expect(restriction.body.data.status).toBe("ACTIVE");
    expect(restriction.body.data.liftedBy).toBeNull();

    const lifted = await lift(otherAdmin, restriction.body.data.id).expect(200);
    expect(lifted.body.data.liftedBy).toEqual({
      id: otherAdmin.id,
      fullName: "Admin B",
    });

    for (const res of [
      warning,
      restriction,
      lifted,
      await http()
        .get(`${BASE}/users/${target.id}/warnings`)
        .set(auth(admin))
        .expect(200),
      await http()
        .get(`${BASE}/restrictions?userId=${target.id}`)
        .set(auth(admin))
        .expect(200),
    ]) {
      const json = JSON.stringify(res.body);
      expect(json).not.toContain(target.email);
      expect(json).not.toContain(admin.email);
      expect(json).not.toMatch(/"email"|"password"/);
    }
  });

  it("D3: reason and liftReason accept 1000 chars, reject 1001 and blank", async () => {
    const target = await createTestUser(ds);
    const send = (reason: string) =>
      http()
        .post(`${BASE}/warnings`)
        .set(auth(admin))
        .send({ userId: target.id, reason });
    await send("a".repeat(1000)).expect(201);
    expect(messages(await send("a".repeat(1001)).expect(400))).toEqual([
      expect.stringContaining("shorter than or equal to 1000"),
    ]);
    for (const blank of ["", "   ", "\t\n"]) {
      expect(messages(await send(blank).expect(400))).toContain(
        "reason must not be blank",
      );
    }
    await createRestriction(
      admin,
      temporary(target.id, { reason: "a".repeat(1001) }),
    ).expect(400);

    const restriction = await createRestriction(admin, temporary(target.id))
      .expect(201);
    const id = restriction.body.data.id as string;
    await lift(admin, id, "a".repeat(1001)).expect(400);
    expect(messages(await lift(admin, id, "  ").expect(400))).toContain(
      "liftReason must not be blank",
    );
    // Neither rejected lift touched the row.
    expect(
      (await ds.getRepository(PostingRestrictionEntity).findOneByOrFail({ id }))
        .liftedAt,
    ).toBeNull();
    await lift(admin, id, "b".repeat(1000)).expect(200);
  });

  it("rejects unknown fields and client-supplied actors", async () => {
    const target = await createTestUser(ds);
    await http()
      .post(`${BASE}/warnings`)
      .set(auth(admin))
      .send({ userId: target.id, reason: "x", issuedById: otherAdmin.id })
      .expect(400);
    expect(
      await ds.getRepository(UserWarningEntity).countBy({ userId: target.id }),
    ).toBe(0);
  });

  it("D2: lift ACTIVE/SCHEDULED/PERMANENT; EXPIRED and LIFTED are 400", async () => {
    const target = await createTestUser(ds);
    const repo = ds.getRepository(PostingRestrictionEntity);
    // An already-expired window cannot be created through the API.
    const expired = await repo.save(
      repo.create({
        userId: target.id,
        type: TEMPORARY,
        reason: "Đã hết hạn",
        startsAt: new Date(Date.now() - 3 * HOUR),
        expiresAt: new Date(Date.now() - HOUR),
        issuedById: otherAdmin.id,
      }),
    );
    const listed = await http()
      .get(`${BASE}/restrictions`)
      .query({ userId: target.id, status: "EXPIRED" })
      .set(auth(admin))
      .expect(200);
    expect(listed.body.data.items.map((r: { id: string }) => r.id)).toEqual([
      expired.id,
    ]);

    const rejected = await lift(admin, expired.id).expect(400);
    expect(messages(rejected)).toEqual([
      "Posting restriction has already expired",
    ]);
    expect(await repo.findOneByOrFail({ id: expired.id })).toMatchObject({
      liftedAt: null,
      liftedById: null,
      liftReason: null,
      reason: "Đã hết hạn",
    });

    const scheduled = await createRestriction(
      admin,
      temporary(target.id, { startsAt: inHours(1), expiresAt: inHours(2) }),
    ).expect(201);
    expect(scheduled.body.data.status).toBe("SCHEDULED");
    const permanent = await createRestriction(admin, {
      userId: target.id,
      type: PERMANENT,
      reason: "Lừa đảo",
    }).expect(201);
    const active = await createRestriction(admin, temporary(target.id))
      .expect(201);

    for (const res of [scheduled, permanent, active]) {
      const done = await lift(admin, res.body.data.id).expect(200);
      expect(done.body.data).toMatchObject({
        status: "LIFTED",
        liftReason: "Kháng cáo",
        liftedBy: { id: admin.id, fullName: "Admin A" },
      });
      expect(
        messages(await lift(otherAdmin, res.body.data.id).expect(400)),
      ).toEqual(["Posting restriction has already been lifted"]);
    }
    expect(await repo.countBy({ userId: target.id })).toBe(4);
  });

  it("D1: an admin reads their own history but cannot create or lift on self", async () => {
    const self = await createTestUser(ds, { isAdmin: true, fullName: "Self" });
    const own = await createRestriction(otherAdmin, temporary(self.id))
      .expect(201);
    const id = own.body.data.id as string;
    await http()
      .post(`${BASE}/warnings`)
      .set(auth(otherAdmin))
      .send({ userId: self.id, reason: "Cảnh báo" })
      .expect(201);

    const detail = await http()
      .get(`${BASE}/restrictions/${id}`)
      .set(auth(self))
      .expect(200);
    expect(detail.body.data.user).toEqual({ id: self.id, fullName: "Self" });
    for (const path of [
      `${BASE}/users/${self.id}/restrictions`,
      `${BASE}/users/${self.id}/warnings`,
      `${BASE}/restrictions?userId=${self.id}`,
      `${BASE}/warnings?userId=${self.id}`,
    ]) {
      const res = await http().get(path).set(auth(self)).expect(200);
      expect(res.body.data.items).toHaveLength(1);
    }

    for (const res of [
      await lift(self, id),
      await createRestriction(self, temporary(self.id)),
      await http()
        .post(`${BASE}/warnings`)
        .set(auth(self))
        .send({ userId: self.id, reason: "x" }),
    ]) {
      expect(res.status).toBe(403);
      expect(messages(res)).toEqual(["You cannot moderate your own account"]);
    }
    expect(
      (await ds.getRepository(PostingRestrictionEntity).findOneByOrFail({ id }))
        .liftedAt,
    ).toBeNull();
  });

  it("D4: [createdFrom, createdTo) with explicit offsets; from >= to is 400", async () => {
    const target = await createTestUser(ds);
    const warnings = ds.getRepository(UserWarningEntity);
    const t0 = new Date("2026-10-01T00:00:00.000Z").getTime();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await http()
        .post(`${BASE}/warnings`)
        .set(auth(admin))
        .send({ userId: target.id, reason: `Cảnh báo ${i}` })
        .expect(201);
      ids.push(res.body.data.id);
      await warnings.update(res.body.data.id, {
        createdAt: new Date(t0 + i * HOUR),
      });
    }
    const list = (query: Record<string, string>) =>
      http()
        .get(`${BASE}/warnings`)
        .query({ userId: target.id, order: "ASC", ...query })
        .set(auth(admin));
    const idsOf = (res: { body: { data: { items: { id: string }[] } } }) =>
      res.body.data.items.map((w) => w.id);

    // from inclusive (08:00+07:00 == 01:00Z), to exclusive (02:00Z).
    const middle = await list({
      createdFrom: "2026-10-01T08:00:00+07:00",
      createdTo: "2026-10-01T02:00:00Z",
    }).expect(200);
    expect(idsOf(middle)).toEqual([ids[1]]);
    expect(middle.body.data.meta).toMatchObject({ total: 1, page: 1 });
    expect(
      idsOf(await list({ createdFrom: "2026-10-01T00:00:00Z" }).expect(200)),
    ).toEqual(ids);

    for (const [from, to] of [
      ["2026-10-01T01:00:00Z", "2026-10-01T01:00:00Z"],
      ["2026-10-01T08:00:00+07:00", "2026-10-01T01:00:00Z"],
      ["2026-10-01T02:00:00Z", "2026-10-01T01:00:00Z"],
    ]) {
      for (const path of ["warnings", "restrictions"]) {
        const res = await http()
          .get(`${BASE}/${path}`)
          .query({ createdFrom: from, createdTo: to })
          .set(auth(admin))
          .expect(400);
        expect(messages(res)).toEqual([
          "createdFrom must be earlier than createdTo",
        ]);
      }
    }

    for (const value of [
      "2026-10-01",
      "2026-10-01T01:00:00",
      "2026-10-01T01:00:00+0700",
    ]) {
      expect(messages(await list({ createdFrom: value }).expect(400))).toContain(
        "createdFrom must include a timezone (Z or ±HH:mm)",
      );
    }
    await createRestriction(
      admin,
      temporary(target.id, { expiresAt: "2099-01-01T00:00:00" }),
    ).expect(400);
  });
});
