import { UserService } from "../../src/modules/user/user.service";
import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { DataSource, type EntityManager } from "typeorm";
import request from "supertest";
import { io, Socket } from "socket.io-client";
import { uuidv7 } from "uuidv7";
import { AppModule } from "../../src/app.module";
import { configureApplication } from "../../src/main";
import { UserEntity } from "../../src/modules/user/user.entity";
import { PostEntity, PostStatus } from "../../src/modules/posts/post.entity";
import { RefreshTokenEntity } from "../../src/modules/refresh-token/refresh-token.entity";
import {
  ReportEntity,
  ReportReason,
  ReportStatus,
  ReportTargetType,
} from "../../src/modules/reports/report.entity";
import {
  NotificationEntity,
  NotificationType,
} from "../../src/modules/notifications/notification.entity";
import { PostsService } from "../../src/modules/posts/posts.service";
import { PostImagesService } from "../../src/modules/post-images/post-images.service";
import { PostImageEntity } from "../../src/modules/post-images/post-image.entity";
import { AuthorizationService } from "../../src/modules/authorization/authorization.service";
import { AuthPrincipalService } from "../../src/common/auth-principal/auth-principal.service";
import { SessionRegistryService } from "../../src/common/session-registry/session-registry.service";
import { RealtimeService } from "../../src/modules/realtime/realtime.service";
import { AccountLifecycleService } from "../../src/common/account-lifecycle/account-lifecycle.service";
import { RefreshTokenService } from "../../src/modules/refresh-token/refresh-token.service";
import { CategoryService } from "../../src/modules/categories/category.service";
import { StorageService } from "../../src/modules/storage/storage.service";
import { AuthorizationModule } from "../../src/modules/authorization/authorization.module";
import { Controller, Get, Module } from "@nestjs/common";
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

describe("CASL HTTP and WS authorization contracts", () => {
  let app: INestApplication, ds: DataSource, url: string, jwt: JwtService;
  let admin: UserEntity,
    seller: UserEntity,
    buyer: UserEntity,
    post: PostEntity,
    conversationId: string;
  const sockets: Socket[] = [];
  const refreshStrings = new Map<string, string>();
  const token = (user: UserEntity) =>
    jwt.sign(
      { id: user.id, email: user.email, isAdmin: !user.isAdmin },
      { expiresIn: "15m" },
    );
  const api = (user?: UserEntity) => {
    const req = request(app.getHttpServer());
    const auth = user ? { Authorization: `Bearer ${token(user)}` } : {};
    return {
      get: (path: string) => req.get(`/api/v1/${path}`).set(auth),
      post: (path: string) => req.post(`/api/v1/${path}`).set(auth),
      patch: (path: string) => req.patch(`/api/v1/${path}`).set(auth),
      delete: (path: string) => req.delete(`/api/v1/${path}`).set(auth),
    };
  };
  async function connect(raw: string, success = true): Promise<Socket> {
    const client = io(`${url}/ws`, {
      auth: { token: raw },
      transports: ["websocket"],
      reconnection: false,
    });
    sockets.push(client);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error("connection timeout")), 5000);
      const finish = (error?: Error) => {
        clearTimeout(timer);
        error ? reject(error) : resolve();
      };
      client.once("connect", () =>
        finish(success ? undefined : Error("unexpected connection")),
      );
      client.once("connect_error", (error) =>
        finish(success ? error : undefined),
      );
    });
    return client;
  }
  const disconnected = (client: Socket) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error("disconnect timeout")), 5000);
      client.once("disconnect", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  const ack = (client: Socket, name: string, body: unknown) =>
    client.timeout(5000).emitWithAck(name, body);
  async function refresh(user: UserEntity) {
    const service = app.get(RefreshTokenService);
    const raw = service.createRefreshToken({
      id: user.id,
      sub: user.id,
      iss: "Backend-core",
      email: user.email,
      isAdmin: user.isAdmin,
    });
    const record = await ds.getRepository(RefreshTokenEntity).save({
      id: uuidv7(),
      user,
      tokenHash: service.hashToken(raw),
      isRevoked: false,
      expiresAt: new Date(Date.now() + 60000),
      deviceInfo: null,
    });
    refreshStrings.set(record.id, raw);
    return record;
  }
  beforeAll(async () => {
    Object.assign(process.env, testDatabaseEnv());
    ds = createTestDataSource();
    await initializeTestDatabase(ds);
    process.env.POSTGRES_SCHEMA = ownedTestSchema(ds);
    process.env.POSTGRES_SYNCHRONIZE = "false";
    [admin, seller, buyer] = await Promise.all([
      createTestUser(ds, { isAdmin: true }),
      createTestUser(ds),
      createTestUser(ds),
    ]);
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
    url = await app.getUrl();
    const created = await api(buyer)
      .post("conversations")
      .send({ postId: post.id })
      .expect(201);
    conversationId = created.body.data.id;
  });
  afterAll(async () => {
    for (const socket of sockets) socket.disconnect();
    if (app) await app.close();
    if (ds) await disposeTestDatabase(ds);
  });
  afterEach(() => jest.restoreAllMocks());
  it("public reads ignore stale auth; protected routes require finite exp", async () => {
    await api().get(`posts/${post.id}`).expect(200);
    await api().get(`posts/${post.id}/images`).expect(200);
    await api().get("user/me").expect(401);
    const noExp = jwt.sign({ id: buyer.id });
    await request(app.getHttpServer())
      .get("/api/v1/user/me")
      .set("Authorization", `Bearer ${noExp}`)
      .expect(401);
    await request(app.getHttpServer())
      .get(`/api/v1/posts/${post.id}`)
      .set("Authorization", "Bearer invalid")
      .expect(200);
    await connect(noExp, false);
  });
  it("database role wins over both promoted and demoted token claims", async () => {
    await api(buyer).get("admin/reports").expect(403);
    await api(admin).get("admin/reports").expect(200);
    const raw = token(admin);
    await ds.getRepository(UserEntity).update(admin.id, { isAdmin: false });
    try {
      await request(app.getHttpServer())
        .get("/api/v1/admin/reports")
        .set("Authorization", `Bearer ${raw}`)
        .expect(403);
    } finally {
      await ds.getRepository(UserEntity).update(admin.id, { isAdmin: true });
    }
  });
  it("admin outsider has no owner or conversation privileges", async () => {
    await api(admin)
      .patch(`posts/${post.id}`)
      .send({ title: "forbidden" })
      .expect(403);
    await api(admin)
      .get(`conversations/${conversationId}/messages`)
      .expect(403);
    await api(admin)
      .post("messages")
      .send({ conversationId, content: "forbidden", clientId: uuidv7() })
      .expect(403);
    const client = await connect(token(admin));
    expect(await ack(client, "chat:join", { conversationId })).toEqual({
      ok: false,
      error: "FORBIDDEN",
    });
    client.disconnect();
  });
  it("mutations reject privileged fields and list scopes apply before paging", async () => {
    await api(seller)
      .patch(`posts/${post.id}`)
      .send({ status: "sold" })
      .expect(400);
    await api(buyer).patch("user/me").send({ isAdmin: true }).expect(400);
    await expect(
      app
        .get(PostsService)
        .update(
          post.id,
          { title: "ok", sellerId: admin.id } as never,
          app.get(AuthorizationService).createAuthenticatedContext(seller),
        ),
    ).rejects.toThrow("Unknown field");
    const mine = await api(seller).get("posts/me?limit=1").expect(200);
    expect(mine.body.data.meta.total).toBe(1);
    const other = await api(buyer).get("posts/me?limit=1").expect(200);
    expect(other.body.data.meta.total).toBe(0);
  });
  it("hidden post update is blocked and restore preserves hidden status", async () => {
    const hidden = await createTestPost(ds, seller.id, post.categoryId, {
      status: PostStatus.HIDDEN,
    });
    await api(seller)
      .patch(`posts/${hidden.id}`)
      .send({ title: "blocked" })
      .expect(400);
    await api(seller).patch(`posts/${hidden.id}/sold`).send({}).expect(400);
    await api(seller).delete(`posts/${hidden.id}`).expect(200);
    await api(seller).patch(`posts/${hidden.id}/restore`).send({}).expect(200);
    expect(
      (await ds.getRepository(PostEntity).findOneByOrFail({ id: hidden.id }))
        .status,
    ).toBe(PostStatus.HIDDEN);
    await api().get(`posts/${hidden.id}`).expect(404);
  });
  it("notifications are self scoped, including manual read", async () => {
    const n = await ds.getRepository(NotificationEntity).save({
      id: uuidv7(),
      userId: seller.id,
      type: NotificationType.NEW_MESSAGE,
      refId: null,
      title: "private",
      body: null,
      isRead: false,
    });
    const own = await api(seller).get("notifications").expect(200);
    expect(own.body.data.items.some((v: { id: string }) => v.id === n.id)).toBe(
      true,
    );
    const other = await api(admin).get("notifications").expect(200);
    expect(other.body.data.items).toEqual([]);
    await api(admin).patch(`notifications/${n.id}/read`).send({}).expect(404);
    expect(
      (await ds.getRepository(NotificationEntity).findOneByOrFail({ id: n.id }))
        .isRead,
    ).toBe(false);
  });
  it("locked and deleted principals cannot handshake", async () => {
    const locked = await createTestUser(ds, { isLocked: true }),
      deleted = await createTestUser(ds);
    await ds.getRepository(UserEntity).softDelete(deleted.id);
    await connect(token(locked), false);
    await connect(token(deleted), false);
    await api(locked).get("user/me").expect(401);
    await api(deleted).get("user/me").expect(401);
  });
  it("lookup failure returns INTERNAL_ERROR instead of UNAUTHORIZED", async () => {
    jest
      .spyOn(app.get(AuthPrincipalService), "resolveFromVerifiedClaims")
      .mockRejectedValueOnce(Error("DB down"));
    const client = io(`${url}/ws`, {
      auth: { token: token(buyer) },
      transports: ["websocket"],
      reconnection: false,
    });
    sockets.push(client);
    const error = await new Promise<Error>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error("timeout")), 5000);
      client.once("connect_error", (e) => {
        clearTimeout(timer);
        resolve(e);
      });
    });
    expect(error.message).toBe("INTERNAL_ERROR");
  });
  it("typing needs room membership and checks the current DB account", async () => {
    const client = await connect(token(buyer));
    expect(
      await ack(client, "chat:typing", { conversationId, isTyping: false }),
    ).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await ack(client, "chat:join", { conversationId })).toEqual({
      ok: true,
    });
    await ds.getRepository(UserEntity).update(buyer.id, { isLocked: true });
    const close = disconnected(client);
    try {
      await ack(client, "chat:typing", {
        conversationId,
        isTyping: false,
      }).catch(() => undefined);
      await close;
      expect(client.connected).toBe(false);
    } finally {
      await ds.getRepository(UserEntity).update(buyer.id, { isLocked: false });
    }
  });
  it("idle sockets disconnect at JWT expiry", async () => {
    const raw = jwt.sign({
      id: buyer.id,
      exp: Math.floor(Date.now() / 1000) + 3,
    });
    const client = await connect(raw);
    const close = disconnected(client);
    await close;
    expect(client.connected).toBe(false);
  });
  it("lock revokes refresh tokens and disconnects all tabs after commit", async () => {
    const target = await createTestUser(ds),
      record = await refresh(target),
      a = await connect(token(target)),
      b = await connect(token(target));
    const closes = [disconnected(a), disconnected(b)];
    await api(admin).patch(`user/${target.id}/lock`).send({}).expect(200);
    await Promise.all(closes);
    expect(
      (
        await ds
          .getRepository(RefreshTokenEntity)
          .findOneByOrFail({ id: record.id })
      ).isRevoked,
    ).toBe(true);
    await api(target).get("user/me").expect(401);
    await api(admin).patch(`user/${target.id}/unlock`).send({}).expect(200);
    expect(a.connected).toBe(false);
    await api(target).get("user/me").expect(200);
  });
  it("self delete revokes tokens and disconnects sessions", async () => {
    const target = await createTestUser(ds),
      record = await refresh(target),
      client = await connect(token(target));
    const close = disconnected(client);
    await api(target).delete("user/me").expect(200);
    await close;
    expect(
      (
        await ds
          .getRepository(RefreshTokenEntity)
          .findOneByOrFail({ id: record.id })
      ).isRevoked,
    ).toBe(true);
    await api(target).get("user/me").expect(401);
  });
  it("self lock and report self ban deny without changing state", async () => {
    await api(admin).patch(`user/${admin.id}/lock`).send({}).expect(403);
    const report = await ds.getRepository(ReportEntity).save({
      reporterId: buyer.id,
      targetType: ReportTargetType.USER,
      targetId: admin.id,
      reason: ReportReason.SPAM,
      status: ReportStatus.PENDING,
      description: "test",
      evidenceUrls: [],
    });
    await api(admin)
      .patch(`admin/reports/${report.id}/action`)
      .send({ action: "RESOLVE_BAN_USER" })
      .expect(403);
    expect(
      (await ds.getRepository(ReportEntity).findOneByOrFail({ id: report.id }))
        .status,
    ).toBe(ReportStatus.PENDING);
    expect(
      (await ds.getRepository(UserEntity).findOneByOrFail({ id: admin.id }))
        .isLocked,
    ).toBe(false);
  });
  it("report ban revokes tokens and invalidates sockets", async () => {
    const target = await createTestUser(ds),
      record = await refresh(target),
      client = await connect(token(target));
    const close = disconnected(client);
    const report = await ds.getRepository(ReportEntity).save({
      reporterId: buyer.id,
      targetType: ReportTargetType.USER,
      targetId: target.id,
      reason: ReportReason.SPAM,
      status: ReportStatus.PENDING,
      description: "test",
      evidenceUrls: [],
    });
    await api(admin)
      .patch(`admin/reports/${report.id}/action`)
      .send({ action: "RESOLVE_BAN_USER" })
      .expect(200);
    await close;
    expect(
      (
        await ds
          .getRepository(RefreshTokenEntity)
          .findOneByOrFail({ id: record.id })
      ).isRevoked,
    ).toBe(true);
    expect(
      (await ds.getRepository(ReportEntity).findOneByOrFail({ id: report.id }))
        .status,
    ).toBe(ReportStatus.RESOLVED);
  });
  it("pending handshake invalidation wins over a stale successful DB result", async () => {
    const target = await createTestUser(ds);
    const principals = app.get(AuthPrincipalService);
    const original = principals.resolveFromVerifiedClaims.bind(principals);
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((r) => (release = r)),
      started = new Promise<void>((r) => (entered = r));
    jest
      .spyOn(principals, "resolveFromVerifiedClaims")
      .mockImplementationOnce(async (claims) => {
        const value = await original(claims);
        entered();
        await gate;
        return value;
      });
    const pending = connect(token(target), false);
    await started;
    app.get(SessionRegistryService).invalidateUser(target.id);
    release();
    const client = await pending;
    expect(client.connected).toBe(false);
  });
  it("outbound recipient filter excludes sessions as soon as invalidated", async () => {
    const client = await connect(token(buyer));
    const registry = app.get(SessionRegistryService),
      records = registry.eligibleSocketsForUser(buyer.id);
    expect(records.length).toBe(1);
    registry.markInvalid(records[0].socketId);
    expect(registry.eligibleSocketsForUser(buyer.id)).toEqual([]);
    expect(() =>
      app.get(RealtimeService).emitToUser(buyer.id, "private:test", {}),
    ).not.toThrow();
    client.disconnect();
  });
  async function waitForBlockedUserLock(): Promise<void> {
    for (let attempt = 0; attempt < 30; attempt++) {
      const rows = await ds.query(
        "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%FOR UPDATE%' AND query LIKE '%user%'",
      );
      if (rows[0].count > 0) return;
    }
    throw Error("Expected a transaction waiting on the held user row");
  }
  it.each(["rotation", "issuance"])(
    "lock wins concurrent refresh %s, and unlock cannot revive revoked tokens",
    async (mode) => {
      const target = await createTestUser(ds),
        old = await refresh(target),
        lifecycle = app.get(AccountLifecycleService),
        service = app.get(RefreshTokenService),
        context = app
          .get(AuthorizationService)
          .createAuthenticatedContext(admin);
      const runner = ds.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      try {
        await lifecycle.lockWithManager(runner.manager, context, target.id);
        const data = {
          userId: target.id,
          tokenHash: uuidv7(),
          expiresAt: new Date(Date.now() + 60000),
        };
        const pending = (
          mode === "rotation"
            ? service.rotateToken({
                oldTokenId: old.id,
                userId: target.id,
                newTokenHash: data.tokenHash,
                expiresAt: data.expiresAt,
              })
            : service.createRefreshTokenRecord(data)
        ).then(
          (value) => ({ value, error: null }),
          (error) => ({ value: null, error }),
        );
        await waitForBlockedUserLock();
        await runner.commitTransaction();
        lifecycle.invalidateCommittedAccount(target.id, "test-lock");
        expect((await pending).error).toBeTruthy();
        expect(
          await ds
            .getRepository(RefreshTokenEntity)
            .countBy({ user: { id: target.id }, isRevoked: false }),
        ).toBe(0);
        await lifecycle.unlockAccount(context, target.id);
        await expect(
          service.processToken(refreshStrings.get(old.id)!),
        ).rejects.toThrow("Refresh token invalid");
        expect(
          (
            await ds
              .getRepository(RefreshTokenEntity)
              .findOneByOrFail({ id: old.id })
          ).isRevoked,
        ).toBe(true);
      } finally {
        if (runner.isTransactionActive) await runner.rollbackTransaction();
        await runner.release();
      }
    },
  );
  it.each(["rotation", "issuance"])(
    "refresh %s wins its user lock first; subsequent lock revokes its committed token",
    async (mode) => {
      const target = await createTestUser(ds),
        old = await refresh(target),
        appDs = app.get(DataSource),
        original = appDs.transaction.bind(appDs),
        service = app.get(RefreshTokenService),
        lifecycle = app.get(AccountLifecycleService);
      let release!: () => void, entered!: () => void;
      const gate = new Promise<void>((r) => (release = r)),
        started = new Promise<void>((r) => (entered = r));
      jest.spyOn(appDs, "transaction").mockImplementationOnce(((
        callback: (manager: EntityManager) => Promise<unknown>,
      ) =>
        original(async (manager) => {
          const value = await callback(manager);
          entered();
          await gate;
          return value;
        })) as typeof appDs.transaction);
      const data = {
        userId: target.id,
        tokenHash: uuidv7(),
        expiresAt: new Date(Date.now() + 60000),
      };
      const issuing =
        mode === "rotation"
          ? service.rotateToken({
              oldTokenId: old.id,
              userId: target.id,
              newTokenHash: data.tokenHash,
              expiresAt: data.expiresAt,
            })
          : service.createRefreshTokenRecord(data);
      await started;
      const locking = lifecycle.lockAccount(
        app.get(AuthorizationService).createAuthenticatedContext(admin),
        target.id,
      );
      try {
        await waitForBlockedUserLock();
      } finally {
        release();
      }
      await Promise.all([issuing, locking]);
      expect(
        await ds
          .getRepository(RefreshTokenEntity)
          .countBy({ user: { id: target.id }, isRevoked: false }),
      ).toBe(0);
    },
  );
  it("failed transaction rolls back account and token mutations and leaves sockets active", async () => {
    const target = await createTestUser(ds),
      record = await refresh(target),
      client = await connect(token(target)),
      lifecycle = app.get(AccountLifecycleService);
    await expect(
      ds.transaction(async (manager) => {
        await lifecycle.lockWithManager(
          manager,
          app.get(AuthorizationService).createAuthenticatedContext(admin),
          target.id,
        );
        await manager.query("SELECT 1/0");
      }),
    ).rejects.toThrow();
    expect(
      (await ds.getRepository(UserEntity).findOneByOrFail({ id: target.id }))
        .isLocked,
    ).toBe(false);
    expect(
      (
        await ds
          .getRepository(RefreshTokenEntity)
          .findOneByOrFail({ id: record.id })
      ).isRevoked,
    ).toBe(false);
    expect(client.connected).toBe(true);
    expect(
      app.get(SessionRegistryService).eligibleSocketsForUser(target.id),
    ).toHaveLength(1);
    client.disconnect();
  });
  it("concurrent report resolution serializes both same-report and same-target operations", async () => {
    const target = await createTestPost(ds, seller.id, post.categoryId);
    const make = () =>
      ds.getRepository(ReportEntity).save({
        reporterId: buyer.id,
        targetType: ReportTargetType.POST,
        targetId: target.id,
        reason: ReportReason.SPAM,
        status: ReportStatus.PENDING,
        description: "test",
        evidenceUrls: [],
      });
    const one = await make();
    const otherAdmin = await createTestUser(ds, { isAdmin: true });
    const results = await Promise.all([
      api(admin)
        .patch("admin/reports/" + one.id + "/action")
        .send({ action: "DISMISS", adminNote: "first" }),
      api(otherAdmin)
        .patch("admin/reports/" + one.id + "/action")
        .send({ action: "DISMISS", adminNote: "second" }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    const [a, b] = await Promise.all([make(), make()]);
    const hidden = await Promise.all([
      api(admin)
        .patch("admin/reports/" + a.id + "/action")
        .send({ action: "RESOLVE_HIDE_POST" }),
      api(admin)
        .patch("admin/reports/" + b.id + "/action")
        .send({ action: "RESOLVE_HIDE_POST" }),
    ]);
    expect(hidden.map((r) => r.status).sort()).toEqual([200, 400]);
    expect(
      (await ds.getRepository(PostEntity).findOneByOrFail({ id: target.id }))
        .status,
    ).toBe(PostStatus.HIDDEN);
    const reports = await ds
      .getRepository(ReportEntity)
      .findBy({ targetId: target.id });
    expect(reports.filter((r) => r.status === ReportStatus.PENDING)).toEqual(
      [],
    );
  });
  it("category mutations deny users both through HTTP and direct service", async () => {
    await api(buyer).post("categories").send({ name: "forbidden" }).expect(403);
    await expect(
      Promise.resolve().then(() =>
        app
          .get(CategoryService)
          .create(
            { name: "forbidden" },
            app.get(AuthorizationService).createAuthenticatedContext(buyer),
          ),
      ),
    ).rejects.toThrow();
  });
  it("favorite visibility and public reviews preserve sold/hidden contracts", async () => {
    const target = await createTestPost(ds, seller.id, post.categoryId);
    await api(buyer).post("favorites").send({ postId: target.id }).expect(201);
    const review = await api(buyer)
      .post("reviews")
      .send({ postId: target.id, rating: 4, comment: "test" })
      .expect(201);
    await api(admin)
      .patch("reviews/" + review.body.data.id)
      .send({ rating: 5 })
      .expect(403);
    await api(admin)
      .delete("reviews/" + review.body.data.id)
      .expect(403);
    for (const status of [PostStatus.SOLD, PostStatus.HIDDEN]) {
      await ds.getRepository(PostEntity).update(target.id, { status });
      await api()
        .get("posts/" + target.id + "/reviews")
        .expect(200);
      await api(buyer)
        .post("favorites")
        .send({ postId: target.id })
        .expect(404);
      const list = await api(buyer).get("favorites").expect(200);
      expect(list.body.data.items.length).toBe(
        status === PostStatus.SOLD ? 1 : 0,
      );
      await request(app.getHttpServer())
        .get("/api/v1/posts/" + target.id)
        .set("Authorization", "Bearer " + token(seller))
        .expect(404);
    }
    await api(buyer)
      .delete("favorites/" + target.id)
      .expect(200);
    await api(buyer)
      .delete("favorites/" + target.id)
      .expect(200);
    await api(buyer)
      .patch("reviews/" + review.body.data.id)
      .send({ comment: null })
      .expect(200);
    await api()
      .get("reviews/" + review.body.data.id)
      .expect(200)
      .expect((r) => expect(r.body.data.comment).toBeNull());
  });
  it("join suspended across invalidation cannot later join the room", async () => {
    const client = await connect(token(buyer)),
      principals = app.get(AuthPrincipalService),
      original = principals.resolveActive.bind(principals);
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((r) => (release = r)),
      started = new Promise<void>((r) => (entered = r));
    jest
      .spyOn(principals, "resolveActive")
      .mockImplementationOnce(async (id) => {
        const value = await original(id);
        entered();
        await gate;
        return value;
      });
    const joining = ack(client, "chat:join", { conversationId }).catch(
      () => null,
    );
    await started;
    const records = app
      .get(SessionRegistryService)
      .eligibleSocketsForUser(buyer.id);
    app.get(SessionRegistryService).invalidateUser(buyer.id);
    release();
    await joining;
    for (const record of records)
      expect(record.socketRef.rooms.has("conversation:" + conversationId)).toBe(
        false,
      );
    client.disconnect();
  });
  it("startup audit rejects a routed handler without an access declaration", async () => {
    @Controller("uncovered")
    class UncoveredController {
      @Get() read() {}
    }
    @Module({
      imports: [AuthorizationModule],
      controllers: [UncoveredController],
    })
    class UncoveredModule {}
    const uncovered = await NestFactory.create(UncoveredModule, {
      logger: false,
      abortOnError: false,
    });
    try {
      await expect(uncovered.init()).rejects.toThrow(
        "Route authorization audit failed",
      );
      expect(uncovered.getHttpServer().listening).toBe(false);
    } finally {
      await uncovered.close();
    }
  });

  it.each(["update", "markSold"])(
    "post hide wins a concurrent owner %s without losing HIDDEN",
    async (action) => {
      const target = await createTestPost(ds, seller.id, post.categoryId),
        runner = ds.createQueryRunner(),
        service = app.get(PostsService),
        context = app
          .get(AuthorizationService)
          .createAuthenticatedContext(seller);
      await runner.connect();
      await runner.startTransaction();
      try {
        await runner.manager.update(PostEntity, target.id, {
          status: PostStatus.HIDDEN,
        });
        const pending = (
          action === "update"
            ? service.update(target.id, { title: "later update" }, context)
            : service.markAsSold(target.id, context)
        ).then(
          () => null,
          (error) => error,
        );
        let blocked = false;
        for (let i = 0; i < 30; i++) {
          const rows = await ds.query(
            "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FOR UPDATE%' AND query LIKE '%posts%'",
          );
          if (rows[0].count > 0) {
            blocked = true;
            break;
          }
        }
        expect(blocked).toBe(true);
        await runner.commitTransaction();
        expect((await pending).status).toBe(400);
        expect(
          (
            await ds
              .getRepository(PostEntity)
              .findOneByOrFail({ id: target.id })
          ).status,
        ).toBe(PostStatus.HIDDEN);
      } finally {
        if (runner.isTransactionActive) await runner.rollbackTransaction();
        await runner.release();
      }
    },
  );
  it("image create locks the parent and cannot outlive a concurrent parent delete", async () => {
    const target = await createTestPost(ds, seller.id, post.categoryId),
      runner = ds.createQueryRunner(),
      context = app
        .get(AuthorizationService)
        .createAuthenticatedContext(seller);
    await runner.connect();
    await runner.startTransaction();
    try {
      await runner.manager.softDelete(PostEntity, target.id);
      const pending = app
        .get(PostImagesService)
        .create(target.id, { url: "https://example.com/image.png" }, context)
        .then(
          () => null,
          (error) => error,
        );
      let blocked = false;
      for (let i = 0; i < 30; i++) {
        const rows = await ds.query(
          "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FOR UPDATE%' AND query LIKE '%posts%'",
        );
        if (rows[0].count > 0) {
          blocked = true;
          break;
        }
      }
      expect(blocked).toBe(true);
      await runner.commitTransaction();
      expect((await pending).status).toBe(404);
      expect(
        await ds.getRepository(PostImageEntity).countBy({ postId: target.id }),
      ).toBe(0);
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
    }
  });
  it("self-delete failure rolls back refresh revoke and preserves sessions", async () => {
    const target = await createTestUser(ds),
      record = await refresh(target),
      client = await connect(token(target)),
      appDs = app.get(DataSource),
      original = appDs.transaction.bind(appDs);
    jest.spyOn(appDs, "transaction").mockImplementationOnce(((
      callback: (manager: EntityManager) => Promise<unknown>,
    ) =>
      original(async (manager) => {
        jest
          .spyOn(manager, "softDelete")
          .mockRejectedValueOnce(Error("forced delete failure"));
        return callback(manager);
      })) as typeof appDs.transaction);
    await api(target).delete("user/me").expect(500);
    expect(
      (
        await ds
          .getRepository(RefreshTokenEntity)
          .findOneByOrFail({ id: record.id })
      ).isRevoked,
    ).toBe(false);
    expect(await ds.getRepository(UserEntity).existsBy({ id: target.id })).toBe(
      true,
    );
    expect(client.connected).toBe(true);
    client.disconnect();
  });
  it("disconnect failure after commit keeps the marker invalid and filters outbound packets", async () => {
    const target = await createTestUser(ds),
      client = await connect(token(target)),
      registry = app.get(SessionRegistryService),
      record = registry.eligibleSocketsForUser(target.id)[0];
    jest.spyOn(record.socketRef, "disconnect").mockImplementation(() => {
      throw Error("transport failure");
    });
    await api(admin)
      .patch("user/" + target.id + "/lock")
      .send({})
      .expect(200);
    expect(
      (await ds.getRepository(UserEntity).findOneByOrFail({ id: target.id }))
        .isLocked,
    ).toBe(true);
    expect(registry.isEligible(record.socketId)).toBe(false);
    expect(registry.get(record.socketId)?.status).toBe("invalidated");
    expect(registry.eligibleSocketsForUser(target.id)).toEqual([]);
    client.disconnect();
  });
  it("internal location/post callers cannot override identity or privileged create fields", async () => {
    const context = app
      .get(AuthorizationService)
      .createAuthenticatedContext(buyer);
    await expect(
      app.get(UserService).updateDefaultLocation(context, {
        latitude: 10,
        longitude: 106,
        userId: admin.id,
      } as never),
    ).rejects.toThrow("Unknown location field");
    expect(
      (await ds.getRepository(UserEntity).findOneByOrFail({ id: admin.id }))
        .location,
    ).toBeNull();
    await expect(
      app.get(PostsService).create(
        {
          categoryId: post.categoryId,
          title: "normal title",
          description: "normal description",
          price: "100",
          condition: post.condition,
          isAdmin: true,
          status: PostStatus.HIDDEN,
        } as never,
        context,
      ),
    ).rejects.toThrow("Unknown post field");
  });
  it("conversation list/count and locked profile target retain their scoped contracts", async () => {
    const created = await api(admin)
      .post("conversations")
      .send({ postId: post.id })
      .expect(201);
    const foreignId = created.body.data.id;
    const mine = await api(buyer).get("conversations?limit=1").expect(200);
    expect(mine.body.data.meta.total).toBe(1);
    expect(mine.body.data.items[0].id).toBe(conversationId);
    const foreign = await api(admin).get("conversations?limit=1").expect(200);
    expect(foreign.body.data.meta.total).toBe(1);
    expect(foreign.body.data.items[0].id).toBe(foreignId);
    const locked = await createTestUser(ds, { isLocked: true });
    const profile = await api(buyer)
      .get("user/" + locked.id)
      .expect(200);
    for (const key of ["password", "isLocked", "isAdmin", "deletedAt"])
      expect(profile.body.data[key]).toBeUndefined();
    await api(admin)
      .patch("user/" + admin.id + "/unlock")
      .send({})
      .expect(403);
  });
  it("post update/delete/restore reject outsiders and leave the row unchanged", async () => {
    for (const user of [buyer, admin]) {
      await api(user)
        .patch("posts/" + post.id)
        .send({ title: "unauthorized" })
        .expect(403);
      await api(user)
        .delete("posts/" + post.id)
        .expect(403);
      await api(user)
        .patch("posts/" + post.id + "/restore")
        .send({})
        .expect(403);
    }
    expect(
      (await ds.getRepository(PostEntity).findOneByOrFail({ id: post.id }))
        .deletedAt,
    ).toBeNull();
  });
  it("report ban failure rolls back account/report/token changes without disconnecting", async () => {
    const target = await createTestUser(ds),
      record = await refresh(target),
      client = await connect(token(target)),
      appDs = app.get(DataSource),
      original = appDs.transaction.bind(appDs);
    const report = await ds.getRepository(ReportEntity).save({
      reporterId: buyer.id,
      targetType: ReportTargetType.USER,
      targetId: target.id,
      reason: ReportReason.SPAM,
      status: ReportStatus.PENDING,
      description: "test",
      evidenceUrls: [],
    });
    jest.spyOn(appDs, "transaction").mockImplementationOnce(((
      callback: (manager: EntityManager) => Promise<unknown>,
    ) =>
      original(async (manager) => {
        const update = manager.update.bind(manager);
        jest
          .spyOn(manager, "update")
          .mockImplementation(((target: unknown, ...args: unknown[]) =>
            target === ReportEntity
              ? Promise.reject(Error("forced report update failure"))
              : (update as (...args: unknown[]) => Promise<unknown>)(
                  target,
                  ...args,
                )) as typeof manager.update);
        return callback(manager);
      })) as typeof appDs.transaction);
    await api(admin)
      .patch("admin/reports/" + report.id + "/action")
      .send({ action: "RESOLVE_BAN_USER" })
      .expect(500);
    expect(
      (await ds.getRepository(UserEntity).findOneByOrFail({ id: target.id }))
        .isLocked,
    ).toBe(false);
    expect(
      (await ds.getRepository(ReportEntity).findOneByOrFail({ id: report.id }))
        .status,
    ).toBe(ReportStatus.PENDING);
    expect(
      (
        await ds
          .getRepository(RefreshTokenEntity)
          .findOneByOrFail({ id: record.id })
      ).isRevoked,
    ).toBe(false);
    expect(client.connected).toBe(true);
    client.disconnect();
  });
});
