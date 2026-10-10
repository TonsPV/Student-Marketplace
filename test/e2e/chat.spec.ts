import { AuthorizationService } from "../../src/modules/authorization/authorization.service";
import { CaslAbilityFactory } from "../../src/modules/authorization/casl-ability.factory";
import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { DataSource } from "typeorm";
import request from "supertest";
import { io, Socket } from "socket.io-client";
import {
  S3Client,
  DeleteObjectsCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { uuidv7 } from "uuidv7";
import { createServer, Server } from "http";
import { AppModule } from "../../src/app.module";
import { configureApplication } from "../../src/main";
import { StorageService } from "../../src/modules/storage/storage.service";
import {
  createTestDataSource,
  initializeTestDatabase,
  disposeTestDatabase,
  ownedTestSchema,
  testDatabaseEnv,
} from "../integration/database";
import {
  createTestCategory,
  createTestPost,
  createTestUser,
} from "../integration/fixtures";

describe("real Nest HTTP / Socket.IO / private R2", () => {
  let app: INestApplication;
  let ds: DataSource;
  let url: string;
  let postId: string;
  let buyerId: string;
  let buyerJwt: string;
  let sellerJwt: string;
  let outsiderJwt: string;
  let conversationId: string;
  let r2: S3Client;
  let browserServer: Server | undefined;
  const keys = new Set<string>();
  const sockets: Socket[] = [];
  async function fetchAndDrain(
    ...args: Parameters<typeof fetch>
  ): Promise<Response> {
    const response = await fetch(...args);
    await response.arrayBuffer();
    return response;
  }
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOXYAAAAASUVORK5CYII=",
    "base64",
  );
  const api = (jwt: string) => ({
    get: (path: string) =>
      request(url).get(`/api/v1/${path}`).auth(jwt, { type: "bearer" }),
    post: (path: string) =>
      request(url).post(`/api/v1/${path}`).auth(jwt, { type: "bearer" }),
    patch: (path: string) =>
      request(url).patch(`/api/v1/${path}`).auth(jwt, { type: "bearer" }),
  });
  async function connect(jwt: string): Promise<Socket> {
    const socket = io(`${url}/ws`, {
      auth: { token: jwt },
      transports: ["websocket"],
      reconnection: false,
    });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("connect_error", reject);
      setTimeout(
        () => reject(new Error("socket connect timed out")),
        10000,
      ).unref();
    });
    return socket;
  }
  function event(socket: Socket, name: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Missing ${name}`)),
        10000,
      );
      socket.once(name, (payload) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });
  }
  const ack = (socket: Socket, name: string, body: unknown): Promise<any> =>
    socket.timeout(10000).emitWithAck(name, body);

  beforeAll(async () => {
    const env = testDatabaseEnv();
    Object.assign(process.env, env);
    ds = createTestDataSource();
    await initializeTestDatabase(ds);
    process.env.POSTGRES_SCHEMA = ownedTestSchema(ds);
    process.env.POSTGRES_SYNCHRONIZE = "false";
    const [buyer, seller, outsider] = await Promise.all([
      createTestUser(ds),
      createTestUser(ds),
      createTestUser(ds),
    ]);
    buyerId = buyer.id;
    const category = await createTestCategory(ds);
    postId = (await createTestPost(ds, seller.id, category.id)).id;
    const jwt = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });
    [buyerJwt, sellerJwt, outsiderJwt] = [buyer, seller, outsider].map((user) =>
      jwt.sign({ id: user.id, email: user.email }, { expiresIn: "15m" }),
    );
    app = await NestFactory.create(AppModule, {
      logger: false,
      abortOnError: false,
    });
    configureApplication(app);
    await app.listen(0, "127.0.0.1");
    url = await app.getUrl();
    r2 = new S3Client({
      region: "auto",
      endpoint: process.env.R2_ENDPOINT_URL,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });
    const created = await api(buyerJwt)
      .post("conversations")
      .send({ postId })
      .expect(201);
    conversationId = created.body.data.id;
    expect(conversationId).toBeTruthy();
  });
  afterAll(async () => {
    for (const socket of sockets) socket.disconnect();
    try {
      if (r2 && keys.size) {
        const result = await r2.send(
          new DeleteObjectsCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Delete: { Objects: [...keys].map((Key) => ({ Key })) },
          }),
        );
        expect(result.Errors ?? []).toHaveLength(0);
        for (const Key of keys)
          await expect(
            r2.send(
              new HeadObjectCommand({
                Bucket: process.env.R2_BUCKET_NAME,
                Key,
              }),
            ),
          ).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
      }
    } finally {
      r2?.destroy();
      if (browserServer)
        await new Promise<void>((resolve) =>
          browserServer!.close(() => resolve()),
        );
      if (app) await app.close();
      if (ds) await disposeTestDatabase(ds);
      delete process.env.POSTGRES_SCHEMA;
    }
  });

  it("boots DI and Swagger; REST guards/XOR/alias whitelist are actually enforced", async () => {
    const swagger = await request(url).get("/docs-json").expect(200);
    expect(swagger.body.paths["/api/v1/messages"].post).toBeTruthy();
    await request(url).get("/api/v1/conversations").expect(401);
    await api(buyerJwt)
      .post("messages")
      .send({ content: "missing target", clientId: "invalid" })
      .expect(400);
    await api(buyerJwt)
      .post("messages")
      .send({ postId, conversationId, content: "both", clientId: "invalid" })
      .expect(400);
    await api(buyerJwt)
      .post(`conversations/${conversationId}/messages`)
      .send({ content: "alias", postId })
      .expect(400);
    await api(outsiderJwt).get(`conversations/${conversationId}`).expect(403);
    await api(outsiderJwt)
      .get(`conversations/${conversationId}/messages`)
      .expect(403);
    await api(outsiderJwt)
      .patch(`conversations/${conversationId}/read`)
      .send({ throughMessageId: uuidv7() })
      .expect(403);
    await api(outsiderJwt)
      .post("messages")
      .send({ conversationId, content: "forbidden", clientId: uuidv7() })
      .expect(403);
    await api(buyerJwt)
      .post("uploads/presign")
      .send({ purpose: "avatar", contentType: "image/png", size: 1 })
      .expect(400);
    for (const size of [0, -1, 0.5, 5242881])
      await api(buyerJwt)
        .post("uploads/presign")
        .send({ purpose: "message", contentType: "image/png", size })
        .expect(400);
  });

  it("socket ticket authenticates /ws but cannot authenticate REST or mint another ticket", async () => {
    const issued = await api(buyerJwt).post("realtime/socket-ticket").send({}).expect(201);
    const { ticket, expiresAt, sessionExpiresAt } = issued.body.data;
    expect(typeof ticket).toBe("string");
    expect(new Date(sessionExpiresAt).getTime()).toBeGreaterThan(new Date(expiresAt).getTime());
    await api(ticket).get("conversations").expect(401);
    await api(ticket).post("realtime/socket-ticket").send({}).expect(401);
    const socket = await connect(ticket);
    expect(await ack(socket, "chat:join", { conversationId })).toEqual({ ok: true });
    const received = event(socket, "chat:message:new");
    const sent = await api(sellerJwt).post("messages").send({ conversationId, content: "Ticket-authenticated realtime", clientId: uuidv7() }).expect(201);
    expect((await received).id).toBe(sent.body.data.id);
    socket.disconnect();
  });

  it("WS rejects invalid JWT/body/foreign join, relays false typing and stops after leave", async () => {
    await expect(connect("invalid-jwt")).rejects.toMatchObject({
      message: "UNAUTHORIZED",
    });
    const buyer = await connect(buyerJwt);
    const seller = await connect(sellerJwt);
    const outsider = await connect(outsiderJwt);
    expect(await ack(outsider, "chat:join", { conversationId })).toEqual({
      ok: false,
      error: "FORBIDDEN",
    });
    expect(await ack(buyer, "chat:join", null)).toEqual({
      ok: false,
      error: "BAD_REQUEST",
    });
    expect(
      await ack(buyer, "chat:typing", { conversationId, isTyping: false }),
    ).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await ack(buyer, "chat:join", { conversationId })).toEqual({
      ok: true,
    });
    expect(await ack(seller, "chat:join", { conversationId })).toEqual({
      ok: true,
    });
    const typing = event(seller, "chat:typing");
    expect(
      await ack(buyer, "chat:typing", { conversationId, isTyping: false }),
    ).toEqual({ ok: true });
    expect(await typing).toMatchObject({
      conversationId,
      userId: buyerId,
      isTyping: false,
    });
    expect(
      await ack(buyer, "chat:typing", { conversationId, isTyping: "false" }),
    ).toEqual({ ok: false, error: "BAD_REQUEST" });
    expect(await ack(buyer, "chat:leave", { conversationId: 123 })).toEqual({
      ok: false,
      error: "BAD_REQUEST",
    });
    expect(await ack(buyer, "chat:leave", { conversationId })).toEqual({
      ok: true,
    });
    expect(
      await ack(buyer, "chat:typing", { conversationId, isTyping: true }),
    ).toEqual({ ok: false, error: "FORBIDDEN" });
    buyer.disconnect();
    seller.disconnect();
    outsider.disconnect();
  });

  it("HTTP send commits before WS events; two tabs see authoritative snapshots and read receipts", async () => {
    const buyer = await connect(buyerJwt);
    const seller = await connect(sellerJwt);
    const sellerTab2 = await connect(sellerJwt);
    await ack(buyer, "chat:join", { conversationId });
    await ack(seller, "chat:join", { conversationId });
    const messageEvent = event(seller, "chat:message:new");
    const notiEvent = event(sellerTab2, "notification:changed");
    const updatedEvent = event(sellerTab2, "chat:conversation:updated");
    const tab2Messages = jest.fn();
    sellerTab2.on("chat:message:new", tab2Messages);
    const clientId = uuidv7();
    const sent = await api(buyerJwt)
      .post("messages")
      .send({ conversationId, content: "WS integration", clientId })
      .expect(201);
    expect(await messageEvent).toMatchObject({
      id: sent.body.data.id,
      sequence: sent.body.data.sequence,
    });
    const updated = await updatedEvent;
    const noti = await notiEvent;
    expect(noti.stateVersion).toBe(updated.stateVersion);
    expect(noti.unreadNotification).toMatchObject({
      body: "WS integration",
      isRead: false,
    });
    expect(tab2Messages).not.toHaveBeenCalled();
    const replayEvents = jest.fn();
    seller.on("chat:message:new", replayEvents);
    const replay = await api(buyerJwt)
      .post("messages")
      .send({ conversationId, content: "WS integration", clientId })
      .expect(201);
    expect(replay.body.data.id).toBe(sent.body.data.id);
    expect(replayEvents).not.toHaveBeenCalled();
    const receipt = event(buyer, "chat:read");
    const tab2Noti = event(sellerTab2, "notification:changed");
    const read = await api(sellerJwt)
      .patch(`conversations/${conversationId}/read`)
      .send({ throughMessageId: sent.body.data.id })
      .expect(200);
    expect(read.body.data.updated).toBe(1);
    expect(await receipt).toMatchObject({
      readThroughSequence: sent.body.data.sequence,
      stateVersion: read.body.data.stateVersion,
    });
    expect(await tab2Noti).toMatchObject({
      unreadNotification: null,
      stateVersion: read.body.data.stateVersion,
    });
    const noOp = await api(sellerJwt)
      .patch(`conversations/${conversationId}/read`)
      .send({ throughMessageId: sent.body.data.id })
      .expect(200);
    expect(noOp.body.data).toMatchObject({
      updated: 0,
      stateVersion: read.body.data.stateVersion,
    });
    buyer.disconnect();
    seller.disconnect();
    sellerTab2.disconnect();
    const list = await api(sellerJwt).get("notifications").expect(200);
    expect(list.body.data.snapshots[0].unreadNotification).toBeNull();
    await api(sellerJwt)
      .patch(`notifications/${list.body.data.items[0].id}/read`)
      .expect(200);
    await api(sellerJwt).patch("notifications/read-all").expect(200);
    await api(sellerJwt).get("notifications/unread-count").expect(200);
    await api(sellerJwt).get("messages/unread-count").expect(200);
    await api(sellerJwt).get("conversations").expect(200);
  });

  it("real presigned PUT/HEAD/private GET, missing key, image replay and metadata mismatch", async () => {
    const presign = await api(buyerJwt)
      .post("uploads/presign")
      .send({ purpose: "message", contentType: "image/png", size: png.length })
      .expect(201);
    const { key, uploadUrl } = presign.body.data;
    keys.add(key);
    expect(key.startsWith(`messages/${buyerId}/`)).toBe(true);
    expect(
      new URL(uploadUrl).searchParams.get("X-Amz-SignedHeaders"),
    ).toContain("content-length");
    expect(
      (
        await fetchAndDrain(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": "image/png" },
          body: png,
        })
      ).status,
    ).toBe(200);
    const clientId = uuidv7();
    const sent = await api(buyerJwt)
      .post("messages")
      .send({ conversationId, images: [key], clientId })
      .expect(201);
    const download = await fetch(sent.body.data.images[0]);
    expect(download.status).toBe(200);
    expect(Buffer.from(await download.arrayBuffer())).toEqual(png);
    const unsigned = new URL(sent.body.data.images[0]);
    unsigned.search = "";
    expect([400, 403]).toContain((await fetchAndDrain(unsigned)).status);
    if (process.env.R2_PUBLIC_URL) {
      const publicRead = await fetchAndDrain(
        `${process.env.R2_PUBLIC_URL.replace(/\/$/, "")}/${key}`,
      );
      expect(publicRead.ok).toBe(false);
    }
    const replay = await api(buyerJwt)
      .post("messages")
      .send({ conversationId, images: [key, key], clientId })
      .expect(201);
    expect(replay.body.data.id).toBe(sent.body.data.id);
    await api(buyerJwt)
      .post("messages")
      .send({ conversationId, images: [key], clientId: uuidv7() })
      .expect(409);
    await api(outsiderJwt)
      .post("messages")
      .send({ conversationId, images: [key], clientId: uuidv7() })
      .expect(403);
    await api(buyerJwt)
      .post("messages")
      .send({
        conversationId,
        images: [`messages/${buyerId}/${uuidv7()}.png`],
        clientId: uuidv7(),
      })
      .expect(400);
    const wrong = await api(buyerJwt)
      .post("uploads/presign")
      .send({ purpose: "message", contentType: "image/png", size: png.length })
      .expect(201);
    keys.add(wrong.body.data.key);
    // PUT signature enforcement depends on R2/SDK. If accepted, HEAD must reject mismatched type.
    const put = await fetchAndDrain(wrong.body.data.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "image/jpeg" },
      body: png,
    });
    expect([200, 403]).toContain(put.status);
    await api(buyerJwt)
      .post("messages")
      .send({
        conversationId,
        images: [wrong.body.data.key],
        clientId: uuidv7(),
      })
      .expect(400);
    const history = await api(sellerJwt)
      .get(`conversations/${conversationId}/messages?limit=1`)
      .expect(200);
    expect(history.body.data.items[0].images).toHaveLength(1);
    expect(history.body.data.items[0].imagesExpireAt).toBeTruthy();
    expect(
      await app
        .get(StorageService)
        .headObject(`messages/${buyerId}/${uuidv7()}.png`),
    ).toBeNull();
  });

  it("bucket CORS supports browser PUT/GET from the configured frontend origin", async () => {
    const origin = process.env.FE_DOMAIN!;
    const presign = await api(buyerJwt)
      .post("uploads/presign")
      .send({ purpose: "message", contentType: "image/png", size: png.length })
      .expect(201);
    const response = await fetchAndDrain(presign.body.data.uploadUrl, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "PUT",
        "Access-Control-Request-Headers": "content-type",
      },
    });
    expect(response.ok).toBe(true);
    expect([origin, "*"]).toContain(
      response.headers.get("access-control-allow-origin"),
    );
  });

  it("expired signed GET is denied and authorized history refreshes its URL", async () => {
    const key = [...keys][0];
    expect(key).toBeTruthy();
    const shortLived = new StorageService(
      {
        endpointUrl: process.env.R2_ENDPOINT_URL!,
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
        bucketName: process.env.R2_BUCKET_NAME!,
      },
      {
        maxFileSizeBytes: 5242880,
        putSignedUrlExpiresSec: 300,
        // Allow network latency and second-precision SigV4 timestamps before
        // checking expiration. This changes only the test URL's lifetime.
        getSignedUrlExpiresSec: 15,
      },
      new AuthorizationService(new CaslAbilityFactory()),
    );
    shortLived.onModuleInit();
    try {
      const signed = await shortLived.presignGet(key);
      expect((await fetchAndDrain(signed.url)).ok).toBe(true);
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          Math.max(0, new Date(signed.expiresAt).getTime() - Date.now()) + 1000,
        ),
      );
      expect((await fetchAndDrain(signed.url)).status).toBe(403);
      const history = await api(sellerJwt)
        .get(`conversations/${conversationId}/messages`)
        .expect(200);
      const image = history.body.data.items.find(
        (message: { images: string[] }) => message.images.length > 0,
      );
      expect((await fetchAndDrain(image.images[0])).ok).toBe(true);
      expect(new Date(image.imagesExpireAt).getTime()).toBeGreaterThan(
        Date.now(),
      );
    } finally {
      shortLived.onModuleDestroy();
    }
  });

  if (process.env.TEST_BROWSER_SMOKE === "true") {
    it("native browser uploads and reads with real cross-origin fetch", async () => {
      const origin = new URL(process.env.FE_DOMAIN!);
      let finished: (result: { ok: boolean; message: string }) => void;
      const completion = new Promise<{ ok: boolean; message: string }>(
        (resolve) => {
          finished = resolve;
        },
      );
      browserServer = createServer((req, res) => {
        if (req.url === "/fixture") {
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              url,
              jwt: buyerJwt,
              conversationId,
              png: png.toString("base64"),
            }),
          );
        } else if (req.url === "/track" || req.url === "/done") {
          let body = "";
          req.on("data", (chunk) => {
            body += chunk;
          });
          req.on("end", () => {
            const payload = JSON.parse(body);
            if (req.url === "/track") keys.add(payload.key);
            else finished(payload);
            res.end("OK");
          });
        } else {
          res.setHeader("Content-Type", "text/html");
          res.end(`<!doctype html><html lang="vi"><meta charset="utf-8"><title>Message browser test</title>
            <body><h1>R2 browser PUT/GET</h1><pre id="result">Đang kiểm tra…</pre><script>
            (async()=>{let result;try{
              const f=await (await fetch('/fixture')).json();
              const api=async(path,body)=>{const r=await fetch(f.url+'/api/v1/'+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+f.jwt},body:JSON.stringify(body)});if(!r.ok)throw new Error('API '+r.status);return (await r.json()).data};
              const bytes=Uint8Array.from(atob(f.png),c=>c.charCodeAt(0));
              const p=await api('uploads/presign',{purpose:'message',contentType:'image/png',size:bytes.length});
              await fetch('/track',{method:'POST',body:JSON.stringify({key:p.key})});
              const put=await fetch(p.uploadUrl,{method:'PUT',headers:{'Content-Type':'image/png'},body:bytes});if(!put.ok)throw new Error('PUT '+put.status);
              const sent=await api('messages',{conversationId:f.conversationId,images:[p.key],clientId:crypto.randomUUID()});
              const get=await fetch(sent.images[0]);const data=await get.arrayBuffer();if(!get.ok||data.byteLength!==bytes.length)throw new Error('GET failed');
              result={ok:true,message:'PASS: browser presign → PUT → send → private GET, '+data.byteLength+' bytes'};
            }catch(e){result={ok:false,message:'FAIL: '+e.message};}
            document.querySelector('#result').textContent=result.message;await fetch('/done',{method:'POST',body:JSON.stringify(result)});
            })();</script></body></html>`);
        }
      });
      await new Promise<void>((resolve) =>
        browserServer!.listen(Number(origin.port) || 80, "127.0.0.1", resolve),
      );
      console.info(
        `Browser smoke ready: ${origin.origin}/message-browser-test`,
      );
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          completion,
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("Browser smoke not opened within 90s")),
              90000,
            );
          }),
        ]);
        expect(result).toMatchObject({ ok: true });
        console.info(result.message);
      } finally {
        if (timer) clearTimeout(timer);
      }
    });
  }
});
