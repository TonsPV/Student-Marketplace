jest.mock("@nestjs/schedule", () => ({ Cron: () => () => {} }));
import { DataSource } from "typeorm";
import { ConfigService } from "@nestjs/config";
import { PaymentsService } from "../../src/modules/payments/payments.service";
import {
  PaymentOrder,
  PaymentRequest,
} from "../../src/modules/payments/payment.entity";
import { Promotion } from "../../src/modules/promotions/promotion.entity";
import { PostEntity, PostStatus } from "../../src/modules/posts/post.entity";
import { createHmac } from "node:crypto";
import { PromotionEligibilityService } from "../../src/modules/payments/promotion-eligibility.service";
import { queryResponseFields } from "../../src/modules/payments/querydr";
import { PaymentsPromotions1791810000000 } from "../../src/database/migrations/1791810000000-PaymentsPromotions";
import { UserEntity } from "../../src/modules/user/user.entity";
import { sign } from "../../src/modules/payments/vnpay";
import {
  createTestDataSource,
  initializeTestDatabase,
  disposeTestDatabase,
} from "./database";
import { createTestUser, createTestCategory, createTestPost } from "./fixtures";
import { PostsService } from "../../src/modules/posts/posts.service";
import { SearchPostsDto } from "../../src/modules/posts/dto/search-posts.dto";
import { CategoryEntity } from "../../src/modules/categories/category.entity";
import { AuthorizationService } from "../../src/modules/authorization/authorization.service";
import { CaslAbilityFactory } from "../../src/modules/authorization/casl-ability.factory";
describe("payment transactions", () => {
  let ds: DataSource, s: PaymentsService, owner: string, postId: string;
  beforeAll(async () => {
    ds = createTestDataSource();
    await initializeTestDatabase(ds);
    const runner = ds.createQueryRunner();
    await runner.connect();
    try {
      await new PaymentsPromotions1791810000000().down(runner);
      await new PaymentsPromotions1791810000000().up(runner);
    } finally {
      await runner.release();
    }
    s = new PaymentsService(
      ds,
      new ConfigService({
        VNPAY_API_URL:
          "https://sandbox.vnpayment.vn/merchant_webapi/api/transaction",
        VNPAY_TMN_CODE: "TESTCODE",
        VNPAY_HASH_SECRET: "test-secret",
        VNPAY_PAYMENT_URL: "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html",
        VNPAY_RETURN_URL: "http://localhost:3000/payments/vnpay/return",
      }),
    );
    owner = (await createTestUser(ds)).id;
    const c = await createTestCategory(ds);
    postId = (await createTestPost(ds, owner, c.id)).id;
  });
  afterAll(async () => {
    if (ds) await disposeTestDatabase(ds);
  });
  const event = (ref: string, amount = "1000000") => {
    const p: Record<string, string> = {
      vnp_TmnCode: "TESTCODE",
      vnp_TxnRef: ref,
      vnp_Amount: amount,
      vnp_ResponseCode: "00",
      vnp_TransactionStatus: "00",
      vnp_TransactionNo: "12345678",
    };
    p.vnp_SecureHash = sign(p, "test-secret");
    return p;
  };
  it("serializes checkout creation, reserves retry keys, rejects payload changes", async () => {
    const [a, b] = await Promise.all([
      s.create(owner, postId, "boost_24h", "key-a", "127.0.0.1"),
      s.create(owner, postId, "boost_24h", "key-b", "127.0.0.1"),
    ]);
    expect(a.id).toBe(b.id);
    expect(await ds.getRepository(PaymentOrder).count()).toBe(1);
    await expect(
      s.create(owner, postId, "boost_48h", "key-b", "127.0.0.1"),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      s.read("00000000-0000-4000-8000-000000000000", a.id),
    ).rejects.toMatchObject({ status: 404 });
    expect((await s.ipn(event(a.txnRef, "1"))).RspCode).toBe("04");
    const results = await Promise.all([
      s.ipn(event(a.txnRef)),
      s.ipn(event(a.txnRef)),
    ]);
    expect(results.map((r) => r.RspCode).sort()).toEqual(["00", "02"]);
    expect(await ds.getRepository(Promotion).count()).toBe(1);
    await expect(
      s.create(owner, postId, "boost_24h", "key-c", "127.0.0.1"),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("records paid without fulfillment if post becomes ineligible", async () => {
    const c = await createTestCategory(ds);
    const post = await createTestPost(ds, owner, c.id);
    const o = await s.create(
      owner,
      post.id,
      "boost_24h",
      "sold-key",
      "127.0.0.1",
    );
    await ds
      .getRepository(PostEntity)
      .update(post.id, { status: PostStatus.HIDDEN });
    const p = event(o.txnRef);
    p.vnp_TransactionNo = "87654321";
    p.vnp_SecureHash = sign(p, "test-secret");
    expect((await s.ipn(p)).RspCode).toBe("00");
    expect(await s.read(owner, o.id)).toMatchObject({
      status: "paid",
      fulfillment: "requires_review",
    });
    expect(await ds.getRepository(Promotion).countBy({ postId: post.id })).toBe(
      0,
    );
  });
  it("ranks promotions before pagination and removes priority after expiry", async () => {
    const c = await createTestCategory(ds);
    const newer = await createTestPost(ds, owner, c.id, {
      createdAt: new Date(),
    });
    await ds
      .getRepository(PostEntity)
      .update(postId, { createdAt: new Date("2020-01-01T00:00:00Z") });
    const auth = new AuthorizationService(new CaslAbilityFactory());
    const posts = new PostsService(
      ds.getRepository(PostEntity),
      ds.getRepository(CategoryEntity),
      auth,
      ds,
      {} as never,
    );
    const result = await posts.search(
      Object.assign(new SearchPostsDto(), { limit: 1 }),
      auth.createGuestContext(),
    );
    expect(result.items[0].id).toBe(postId);
    expect(result.items[0].isPromoted).toBe(true);
    const newest = await posts.search(
      Object.assign(new SearchPostsDto(), { limit: 1, sort: "newest" }),
      auth.createGuestContext(),
    );
    expect(newest.items[0].id).toBe(newer.id);
    await ds.getRepository(Promotion).update(
      { postId },
      {
        startsAt: new Date(Date.now() - 2000),
        endsAt: new Date(Date.now() - 1000),
      },
    );
    const expired = await posts.search(
      Object.assign(new SearchPostsDto(), { limit: 1 }),
      auth.createGuestContext(),
    );
    expect(expired.items[0].id).toBe(newer.id);
    expect(expired.items[0].isPromoted).toBe(false);
  });

  afterEach(() => jest.restoreAllMocks());
  let seq = 0;
  async function fresh() {
    const category = await createTestCategory(ds),
      post = await createTestPost(ds, owner, category.id);
    const order = await s.create(
      owner,
      post.id,
      "boost_24h",
      `extra-${++seq}`,
      "127.0.0.1",
    );
    return { post, category, order };
  }
  function callback(ref: string, status = "00", code = "00") {
    const p = event(ref);
    p.vnp_TransactionStatus = status;
    p.vnp_ResponseCode = code;
    p.vnp_TransactionNo = String(900000 + ++seq);
    p.vnp_SecureHash = sign(p, "test-secret");
    return p;
  }
  function mockQuery(status = "00", tamper = false) {
    return jest
      .spyOn(global, "fetch")
      .mockImplementation(async (_url, init) => {
        const req = JSON.parse(init!.body as string);
        const p: Record<string, string> = {
          vnp_ResponseId: "response",
          vnp_Command: "querydr",
          vnp_ResponseCode: "00",
          vnp_Message: "Success",
          vnp_TmnCode: "TESTCODE",
          vnp_TxnRef: req.vnp_TxnRef,
          vnp_Amount: "1000000",
          vnp_BankCode: "NCB",
          vnp_PayDate: "20261031210000",
          vnp_TransactionNo: String(900000 + ++seq),
          vnp_TransactionType: "01",
          vnp_TransactionStatus: status,
          vnp_OrderInfo: req.vnp_OrderInfo,
        };
        p.vnp_SecureHash = createHmac("sha512", "test-secret")
          .update(queryResponseFields.map((k) => p[k] ?? "").join("|"))
          .digest("hex");
        if (tamper) p.vnp_Amount = "1";
        return new Response(JSON.stringify(p), { status: 200 });
      });
  }
  it("validates config at startup and snapshots server amount, hours and VND x100", async () => {
    expect(() => s.onModuleInit()).not.toThrow();
    const { order } = await fresh();
    const row = await ds
      .getRepository(PaymentOrder)
      .findOneByOrFail({ id: order.id });
    expect(row).toMatchObject({ amount: 10000, hours: 24 });
    expect(new URL(row.paymentUrl).searchParams.get("vnp_Amount")).toBe(
      "1000000",
    );
  });
  it("checkout is owner-only and blocks already promoted posts before purchase", async () => {
    const { order, post } = await fresh();
    expect(await s.checkout(owner, post.id)).toMatchObject({ eligible: true });
    await expect(
      s.checkout("00000000-0000-4000-8000-000000000000", post.id),
    ).rejects.toMatchObject({ status: 404 });
    await s.confirmReturn(owner, callback(order.txnRef));
    expect(await s.checkout(owner, post.id)).toMatchObject({
      eligible: false,
      reason: "already_promoted",
    });
  });
  it("signed return replay activates exactly once and non-owner cannot confirm", async () => {
    const { order } = await fresh(),
      p = callback(order.txnRef);
    await expect(
      s.confirmReturn("00000000-0000-4000-8000-000000000000", p),
    ).rejects.toMatchObject({ status: 404 });
    await Promise.all([s.confirmReturn(owner, p), s.confirmReturn(owner, p)]);
    expect(
      await ds.getRepository(Promotion).countBy({ orderId: order.id }),
    ).toBe(1);
  });
  it.each([
    ["02", "99", "failed"],
    ["09", "24", "cancelled"],
    ["05", "99", "pending"],
    ["01", "99", "pending"],
  ])(
    "handles gateway status %s without false success",
    async (status, code, result) => {
      const { order } = await fresh();
      await s.confirmReturn(owner, callback(order.txnRef, status, code));
      expect(await s.read(owner, order.id)).toMatchObject({ status: result });
      expect(
        await ds.getRepository(Promotion).countBy({ orderId: order.id }),
      ).toBe(0);
    },
  );
  it("rolls back service grant when saving payment fails, then allows retry", async () => {
    const { order } = await fresh(),
      p = callback(order.txnRef);
    p.vnp_TransactionNo = "12345678";
    p.vnp_SecureHash = sign(p, "test-secret");
    expect((await s.ipn(p)).RspCode).toBe("99");
    expect(await s.read(owner, order.id)).toMatchObject({
      status: "pending",
      fulfillment: "pending",
    });
    expect(
      await ds.getRepository(Promotion).countBy({ orderId: order.id }),
    ).toBe(0);
    expect((await s.ipn(callback(order.txnRef))).RspCode).toBe("00");
  });
  it("late paid order does not stack with a newer promotion", async () => {
    const { order, post } = await fresh();
    await ds
      .getRepository(PaymentOrder)
      .update(order.id, { expiresAt: new Date(Date.now() - 1000) });
    const next = await s.create(
      owner,
      post.id,
      "boost_48h",
      `late-${++seq}`,
      "127.0.0.1",
    );
    const p = callback(next.txnRef);
    p.vnp_Amount = "1800000";
    p.vnp_SecureHash = sign(p, "test-secret");
    await s.ipn(p);
    await s.ipn(callback(order.txnRef));
    expect(await s.read(owner, order.id)).toMatchObject({
      status: "paid",
      fulfillment: "requires_review",
    });
    expect(await ds.getRepository(Promotion).countBy({ postId: post.id })).toBe(
      1,
    );
  });
  it("locked owner and sold/deleted posts never receive a boost", async () => {
    for (const mode of ["locked", "sold", "deleted"]) {
      const { order, post } = await fresh();
      if (mode === "locked")
        await ds.getRepository(UserEntity).update(owner, { isLocked: true });
      else if (mode === "sold")
        await ds
          .getRepository(PostEntity)
          .update(post.id, { status: PostStatus.SOLD });
      else await ds.getRepository(PostEntity).softDelete(post.id);
      await s.ipn(callback(order.txnRef));
      expect(await s.read(owner, order.id)).toMatchObject({
        status: "paid",
        fulfillment: "requires_review",
      });
      expect(
        await ds.getRepository(Promotion).countBy({ orderId: order.id }),
      ).toBe(0);
      if (mode === "locked")
        await ds.getRepository(UserEntity).update(owner, { isLocked: false });
    }
  });
  it("querydr processing stays unknown, signed success races safely with return", async () => {
    const { order } = await fresh();
    const mock = mockQuery("05");
    await s.reconcile();
    expect(await s.read(owner, order.id)).toMatchObject({ status: "pending" });
    mock.mockRestore();
    mockQuery();
    await Promise.all([
      s.reconcile(),
      s.confirmReturn(owner, callback(order.txnRef)),
    ]);
    expect(await s.read(owner, order.id)).toMatchObject({
      status: "paid",
      fulfillment: "active",
    });
    expect(
      await ds.getRepository(Promotion).countBy({ orderId: order.id }),
    ).toBe(1);
  });
  it("unsigned query errors and tampered responses never mark paid", async () => {
    const { order } = await fresh();
    const mock = jest
      .spyOn(global, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            vnp_ResponseCode: "99",
            vnp_Message: "Unexpected error",
          }),
        ),
      );
    await s.reconcile();
    expect(await s.read(owner, order.id)).toMatchObject({ status: "pending" });
    mock.mockRestore();
    mockQuery("00", true);
    await s.reconcile();
    expect(await s.read(owner, order.id)).toMatchObject({ status: "pending" });
  });
  it("24h unknown becomes manual review and a late verified result can still grant", async () => {
    const { order } = await fresh();
    await ds
      .getRepository(PaymentOrder)
      .update(order.id, { createdAt: new Date(Date.now() - 86401000) });
    mockQuery();
    await s.reconcile();
    expect(await s.read(owner, order.id)).toMatchObject({
      status: "pending",
      fulfillment: "requires_review",
    });
    await s.confirmReturn(owner, callback(order.txnRef));
    expect(await s.read(owner, order.id)).toMatchObject({
      status: "paid",
      fulfillment: "active",
    });
  });
  it("priority uses createdAt within promoted group, filters before pagination and counts once", async () => {
    const a = await fresh(),
      b = await createTestPost(ds, owner, a.category.id),
      c = await createTestPost(ds, owner, a.category.id);
    const bo = await s.create(
      owner,
      b.id,
      "boost_24h",
      `rank-${++seq}`,
      "127.0.0.1",
    );
    await s.ipn(callback(a.order.txnRef));
    await s.ipn(callback(bo.txnRef));
    await ds
      .getRepository(PostEntity)
      .update(a.post.id, { createdAt: new Date("2020-01-01") });
    await ds
      .getRepository(PostEntity)
      .update(b.id, { createdAt: new Date("2021-01-01") });
    await ds
      .getRepository(Promotion)
      .update(
        { orderId: a.order.id },
        { endsAt: new Date(Date.now() + 72 * 3600000) },
      );
    const auth = new AuthorizationService(new CaslAbilityFactory()),
      posts = new PostsService(
        ds.getRepository(PostEntity),
        ds.getRepository(CategoryEntity),
        auth,
        ds,
        {} as never,
      );
    const get = (page: number, sort = "priority") =>
      posts.search(
        Object.assign(new SearchPostsDto(), {
          categoryId: a.category.id,
          limit: 1,
          page,
          sort,
        }),
        auth.createGuestContext(),
      );
    const first = await get(1),
      second = await get(2),
      third = await get(3);
    expect(first.items[0].id).toBe(b.id);
    expect(second.items[0].id).toBe(a.post.id);
    expect(third.items[0].id).toBe(c.id);
    expect(first.meta.total).toBe(3);
    expect((await get(1, "newest")).items[0].id).toBe(c.id);
    await ds.getRepository(Promotion).update(
      { postId: b.id },
      {
        startsAt: new Date(Date.now() - 2000),
        endsAt: new Date(Date.now() - 1000),
      },
    );
    expect((await get(1)).items[0].id).toBe(a.post.id);
  });
  async function expireListing(postId: string) {
    await ds.getRepository(PostEntity).update(postId, {
      status: PostStatus.ACTIVE,
      publishedAt: new Date(Date.now() - 15 * 86400000),
      expiresAt: new Date(Date.now() - 86400000),
    });
  }
  it("rejects overdue listings at checkout, new orders and pending checkout retries before the expiry job", async () => {
    const { order, post } = await fresh();
    const original = await ds
      .getRepository(PaymentOrder)
      .findOneByOrFail({ id: order.id });
    const alias = `expiry-alias-${++seq}`;
    expect(
      (await s.create(owner, post.id, "boost_24h", alias, "127.0.0.1")).id,
    ).toBe(order.id);
    await expireListing(post.id);
    expect(
      (await ds.getRepository(PostEntity).findOneByOrFail({ id: post.id }))
        .status,
    ).toBe(PostStatus.ACTIVE);
    expect(await s.checkout(owner, post.id)).toMatchObject({
      eligible: false,
      reason: "post_expired",
    });
    for (const key of [original.idempotencyKey, alias, `expiry-new-${++seq}`]) {
      await expect(
        s.create(owner, post.id, "boost_24h", key, "127.0.0.1"),
      ).rejects.toMatchObject({ status: 409 });
    }
    // Legacy orders without a PaymentRequest receipt must enforce the same check.
    await ds
      .getRepository(PaymentRequest)
      .delete({ ownerId: owner, key: original.idempotencyKey });
    await expect(
      s.create(
        owner,
        post.id,
        "boost_24h",
        original.idempotencyKey,
        "127.0.0.1",
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      await ds.getRepository(PaymentOrder).countBy({ postId: post.id }),
    ).toBe(1);
    expect(await ds.getRepository(Promotion).countBy({ postId: post.id })).toBe(
      0,
    );
  });
  it("records payment but never grants a boost if the listing expires before return confirmation", async () => {
    const { order, post } = await fresh();
    await expireListing(post.id);
    const p = callback(order.txnRef);
    expect(await s.confirmReturn(owner, p)).toMatchObject({
      status: "paid",
      fulfillment: "requires_review",
      reason: "post_expired",
    });
    await s.confirmReturn(owner, p);
    expect(
      await ds.getRepository(Promotion).countBy({ orderId: order.id }),
    ).toBe(0);
    // Retrying an already paid request still returns the same payment receipt.
    const row = await ds
      .getRepository(PaymentOrder)
      .findOneByOrFail({ id: order.id });
    expect(
      (
        await s.create(
          owner,
          post.id,
          "boost_24h",
          row.idempotencyKey,
          "127.0.0.1",
        )
      ).id,
    ).toBe(order.id);
  });
  it("signed reconciliation also refuses to activate a boost for an overdue active listing", async () => {
    const { order, post } = await fresh();
    await expireListing(post.id);
    mockQuery();
    await s.reconcile();
    expect(await s.read(owner, order.id)).toMatchObject({
      status: "paid",
      fulfillment: "requires_review",
      reason: "post_expired",
    });
    expect(
      await ds.getRepository(Promotion).countBy({ orderId: order.id }),
    ).toBe(0);
  });
  it("uses the current database clock when a transaction crosses the listing deadline", async () => {
    const { post } = await fresh();
    await ds.transaction(async (manager) => {
      await manager.query(
        `UPDATE posts SET published_at=clock_timestamp()-interval '14 days', expires_at=clock_timestamp()+interval '100 milliseconds' WHERE id=$1`,
        [post.id],
      );
      await manager.query("SELECT pg_sleep(0.15)");
      const currentPost = await manager.findOneByOrFail(PostEntity, {
        id: post.id,
      });
      expect(
        await new PromotionEligibilityService().check(
          manager,
          currentPost,
          owner,
        ),
      ).toMatchObject({ eligible: false, reason: "post_expired" });
    });
  });
});
