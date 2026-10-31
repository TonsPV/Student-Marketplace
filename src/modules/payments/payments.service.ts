import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DataSource, EntityManager, MoreThan, In } from "typeorm";
import { randomUUID } from "node:crypto";
import { Cron } from "@nestjs/schedule";
import { PaymentOrder, PaymentRequest } from "./payment.entity";
import { Promotion } from "../promotions/promotion.entity";
import { PostEntity, PostStatus } from "../posts/post.entity";
import { UserEntity } from "../user/user.entity";
import { PromotionEligibilityService } from "./promotion-eligibility.service";
import { queryRequest, verifiedQueryResponse } from "./querydr";
import { isIP } from "node:net";
import { sign, verify, vnDate } from "./vnpay";
@Injectable()
export class PaymentsService implements OnModuleInit {
  private readonly logger = new Logger(PaymentsService.name);
  private reconciling = false;
  constructor(
    private db: DataSource,
    private config: ConfigService,
    private eligibility: PromotionEligibilityService = new PromotionEligibilityService(),
  ) {}
  private secret() {
    const secret = this.config.getOrThrow<string>("VNPAY_HASH_SECRET");
    if (!secret.trim()) throw new Error("VNPAY_HASH_SECRET is empty");
    return secret;
  }
  packages() {
    return [24, 48, 72].map((hours, i) => ({
      code: `boost_${hours}h`,
      hours,
      amount: Number(
        this.config.get(`VNPAY_BOOST_${hours}H_PRICE`) ??
          [10000, 18000, 24000][i],
      ),
    }));
  }
  private async eligible(
    m: EntityManager,
    post: PostEntity | null,
    owner: string,
  ) {
    return (await this.eligibility.check(m, post, owner)).eligible;
  }
  onModuleInit() {
    this.secret();
    if (!isIP(this.config.get<string>("VNPAY_QUERY_IP") ?? "127.0.0.1"))
      throw new Error("Invalid VNPAY_QUERY_IP");
    if (!this.config.get<string>("VNPAY_TMN_CODE")?.trim())
      throw new Error("Missing VNPAY_TMN_CODE");
    if (
      this.config.get("VNPAY_PAYMENT_URL") !==
        "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html" ||
      this.config.get("VNPAY_API_URL") !==
        "https://sandbox.vnpayment.vn/merchant_webapi/api/transaction"
    )
      throw new Error("VNPAY sandbox endpoints required");
    const url = new URL(this.config.getOrThrow<string>("VNPAY_RETURN_URL"));
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error("Invalid VNPAY_RETURN_URL");
    const timeout = Number(
      this.config.get("VNPAY_PAYMENT_TIMEOUT_MINUTES") ?? 15,
    );
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 1440)
      throw new Error("Invalid VNPAY payment timeout");
    if (
      (this.config.get("VNPAY_VERSION") ?? "2.1.0") !== "2.1.0" ||
      !["vn", "en"].includes(this.config.get("VNPAY_LOCALE") ?? "vn")
    )
      throw new Error("Invalid VNPAY protocol configuration");
    if (
      this.packages().some(
        (p) =>
          !Number.isSafeInteger(p.amount) ||
          p.amount <= 0 ||
          p.amount > 999999999,
      )
    )
      throw new Error("Invalid VNPAY package price");
  }
  async checkout(owner: string, postId: string) {
    const post = await this.db
      .getRepository(PostEntity)
      .findOneBy({ id: postId, sellerId: owner });
    if (!post) throw new NotFoundException();
    const eligibility = await this.eligibility.check(
      this.db.manager,
      post,
      owner,
    );
    return { postId, title: post.title, ...eligibility };
  }
  private project(o: PaymentOrder) {
    return {
      id: o.id,
      postId: o.postId,
      packageCode: o.packageCode,
      amount: o.amount,
      txnRef: o.txnRef,
      status: o.status,
      fulfillment: o.fulfillment,
      reason: o.reason,
      expiresAt: o.expiresAt,
      expired: o.expiresAt <= new Date(),
      paymentUrl:
        o.status === "pending" && o.expiresAt > new Date()
          ? o.paymentUrl
          : null,
    };
  }
  async read(owner: string, value: string, reference = false) {
    const o = await this.db.getRepository(PaymentOrder).findOneBy({
      ownerId: owner,
      ...(reference ? { txnRef: value } : { id: value }),
    });
    if (!o) throw new NotFoundException();
    return this.project(o);
  }
  async create(
    owner: string,
    postId: string,
    packageCode: string,
    key: string,
    ip: string,
  ) {
    if (!key || key.length > 128)
      throw new BadRequestException("Invalid Idempotency-Key");
    const pack = this.packages().find((p) => p.code === packageCode);
    if (
      !pack ||
      !Number.isSafeInteger(pack.amount) ||
      pack.amount <= 0 ||
      pack.amount > 999999999
    )
      throw new BadRequestException("Invalid package");
    const version = this.config.get<string>("VNPAY_VERSION") ?? "2.1.0";
    const locale = this.config.get<string>("VNPAY_LOCALE") ?? "vn";
    if (version !== "2.1.0" || !["vn", "en"].includes(locale))
      throw new BadRequestException("Invalid VNPAY protocol configuration");
    const merchant = this.config.getOrThrow<string>("VNPAY_TMN_CODE");
    if (!merchant.trim())
      throw new BadRequestException("Missing VNPAY merchant");
    const returnUrl = new URL(
      this.config.getOrThrow<string>("VNPAY_RETURN_URL"),
    );
    if (
      !["https:", "http:"].includes(returnUrl.protocol) ||
      returnUrl.username ||
      returnUrl.password
    )
      throw new BadRequestException("Invalid return URL");
    const gateway = this.config.getOrThrow<string>("VNPAY_PAYMENT_URL");
    if (gateway !== "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html")
      throw new BadRequestException("Sandbox only");
    const timeout = Number(
      this.config.get("VNPAY_PAYMENT_TIMEOUT_MINUTES") ?? 15,
    );
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 1440)
      throw new BadRequestException("Invalid payment timeout");
    return this.db.transaction(async (m) => {
      // Owner lock serializes idempotency keys across different posts too.
      await m
        .getRepository(UserEntity)
        .createQueryBuilder("u")
        .where("u.id=:owner", { owner })
        .setLock("pessimistic_write")
        .getOne();
      const receipt = await m.findOneBy(PaymentRequest, {
        ownerId: owner,
        key,
      });
      if (receipt) {
        if (receipt.postId !== postId || receipt.packageCode !== packageCode)
          throw new ConflictException("Idempotency payload mismatch");
        return this.project(
          await m.findOneByOrFail(PaymentOrder, { id: receipt.orderId }),
        );
      }
      const prior = await m.findOneBy(PaymentOrder, {
        ownerId: owner,
        idempotencyKey: key,
      });
      if (prior) {
        if (prior.postId !== postId || prior.packageCode !== packageCode)
          throw new ConflictException("Idempotency payload mismatch");
        return this.project(prior);
      }
      const post = await m
        .getRepository(PostEntity)
        .createQueryBuilder("p")
        .where("p.id=:postId", { postId })
        .setLock("pessimistic_write")
        .getOne();
      if (!(await this.eligible(m, post, owner)))
        throw new ConflictException("Post cannot be promoted");
      const open = await m.findOneBy(PaymentOrder, {
        postId,
        status: "pending",
        expiresAt: MoreThan(new Date()),
      });
      if (open) {
        if (open.packageCode !== packageCode)
          throw new ConflictException("Existing checkout uses another package");
        await m.save(
          m.create(PaymentRequest, {
            ownerId: owner,
            key,
            postId,
            packageCode,
            orderId: open.id,
          }),
        );
        return this.project(open);
      }
      await m
        .getRepository(PaymentOrder)
        .createQueryBuilder()
        .update()
        .set({ status: "expired" })
        .where(
          '"postId"=:postId AND status=:status AND "expiresAt"<=CURRENT_TIMESTAMP',
          { postId, status: "pending" },
        )
        .execute();
      const now = new Date(),
        expiresAt = new Date(now.getTime() + timeout * 60000),
        txnRef = randomUUID().replace(/-/g, "");
      const params: Record<string, string> = {
        vnp_Version: version,
        vnp_Command: "pay",
        vnp_TmnCode: merchant,
        vnp_Amount: String(pack.amount * 100),
        vnp_CurrCode: "VND",
        vnp_TxnRef: txnRef,
        vnp_OrderInfo: `Day tin ${txnRef}`,
        vnp_OrderType: "other",
        vnp_Locale: locale,
        vnp_ReturnUrl: returnUrl.href,
        vnp_IpAddr: ip,
        vnp_CreateDate: vnDate(now),
        vnp_ExpireDate: vnDate(expiresAt),
      };
      const url = new URL(gateway);
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
      url.searchParams.set("vnp_SecureHash", sign(params, this.secret()));
      const o = m.create(PaymentOrder, {
        ownerId: owner,
        postId,
        packageCode,
        amount: pack.amount,
        hours: pack.hours,
        txnRef,
        idempotencyKey: key,
        expiresAt,
        paymentUrl: url.toString(),
      });
      await m.save(o);
      await m.save(
        m.create(PaymentRequest, {
          ownerId: owner,
          key,
          postId,
          packageCode,
          orderId: o.id,
        }),
      );
      return this.project(o);
    });
  }
  async confirmReturn(owner: string, input: Record<string, unknown>) {
    if (
      !input ||
      Array.isArray(input) ||
      Object.entries(input).some(
        ([k, v]) => !k.startsWith("vnp_") || typeof v !== "string",
      )
    )
      throw new BadRequestException("Invalid return parameters");
    const params = input as Record<string, string>;
    if (
      !/^[a-f0-9]{32}$/.test(params.vnp_TxnRef ?? "") ||
      !verify(params, this.secret()) ||
      params.vnp_TmnCode !== this.config.get("VNPAY_TMN_CODE")
    )
      throw new BadRequestException("Invalid return signature");
    await this.read(owner, params.vnp_TxnRef, true);
    const result = await this.ipn(input);
    if (!["00", "02"].includes(result.RspCode))
      throw new BadRequestException("Return confirmation rejected");
    return this.read(owner, params.vnp_TxnRef, true);
  }
  async ipn(input: Record<string, unknown>) {
    const reply = (RspCode: string, Message: string) => ({ RspCode, Message });
    if (
      Object.entries(input).some(
        ([k, v]) => !k.startsWith("vnp_") || typeof v !== "string",
      )
    )
      return reply("97", "Invalid input");
    const p = input as Record<string, string>;
    if (
      !verify(p, this.secret()) ||
      p.vnp_TmnCode !== this.config.get("VNPAY_TMN_CODE")
    )
      return reply("97", "Invalid signature");
    if (!/^[a-f0-9]{32}$/.test(p.vnp_TxnRef ?? ""))
      return reply("01", "Order not found");
    const found = await this.db
      .getRepository(PaymentOrder)
      .findOneBy({ txnRef: p.vnp_TxnRef });
    if (!found) return reply("01", "Order not found");
    if (
      !/^\d+$/.test(p.vnp_Amount) ||
      p.vnp_Amount !== String(found.amount * 100)
    )
      return reply("04", "Invalid amount");
    if (
      !/^\d{2}$/.test(p.vnp_ResponseCode ?? "") ||
      !/^\d{2}$/.test(p.vnp_TransactionStatus ?? "")
    )
      return reply("99", "Invalid result");
    try {
      return await this.db.transaction(async (m) => {
        await m
          .getRepository(UserEntity)
          .createQueryBuilder("u")
          .withDeleted()
          .where("u.id=:id", { id: found.ownerId })
          .setLock("pessimistic_write")
          .getOne();
        const post = await m
          .getRepository(PostEntity)
          .createQueryBuilder("p")
          .withDeleted()
          .where("p.id=:id", { id: found.postId })
          .setLock("pessimistic_write")
          .getOne();
        const o = await m.findOneOrFail(PaymentOrder, {
          where: { id: found.id },
          lock: { mode: "pessimistic_write" },
        });
        if (o.status === "paid") return reply("02", "Order already confirmed");
        if (p.vnp_ResponseCode === "00" && p.vnp_TransactionStatus === "00") {
          if (!/^\d+$/.test(p.vnp_TransactionNo ?? ""))
            return reply("99", "Invalid transaction");
          o.status = "paid";
          o.transactionNo = p.vnp_TransactionNo;
          if (await this.eligible(m, post, o.ownerId)) {
            const startsAt = new Date();
            await m.save(
              m.create(Promotion, {
                postId: o.postId,
                orderId: o.id,
                startsAt,
                endsAt: new Date(startsAt.getTime() + o.hours * 3600000),
              }),
            );
            o.fulfillment = "active";
            o.reason = null;
          } else {
            o.fulfillment = "requires_review";
            o.reason = "Post no longer eligible or already promoted";
          }
        } else if (
          p.vnp_ResponseCode === "24" ||
          p.vnp_TransactionStatus === "09"
        ) {
          o.status = "cancelled";
          o.fulfillment = "not_granted";
        } else if (p.vnp_TransactionStatus === "02") {
          o.status = "failed";
          o.fulfillment = "not_granted";
        } else if (!["01", "05"].includes(p.vnp_TransactionStatus)) {
          o.fulfillment = "requires_review";
          o.reason = `Gateway transaction status ${p.vnp_TransactionStatus}`;
        }
        await m.save(o);
        return reply("00", "Confirm Success");
      });
    } catch {
      this.logger.error(`Payment confirmation failed ref=${found.txnRef}`);
      return reply("99", "Processing error");
    }
  }
  @Cron("0 */5 * * * *")
  async reconcile() {
    if (this.reconciling) return;
    this.reconciling = true;
    try {
      await this.reconcileBatch();
    } finally {
      this.reconciling = false;
    }
  }
  private async reconcileBatch() {
    // Unknown outcomes remain pending; never infer failure from elapsed time.
    const orders = await this.db.getRepository(PaymentOrder).find({
      where: { status: In(["pending", "expired"]), fulfillment: "pending" },
      order: { updatedAt: "ASC" },
      take: 50,
    });

    for (const o of orders) {
      await this.db
        .getRepository(PaymentOrder)
        .update(
          { id: o.id, status: In(["pending", "expired"]) },
          { updatedAt: new Date() },
        );
      if (Date.now() - o.createdAt.getTime() > 86400000) {
        await this.db.getRepository(PaymentOrder).update(
          { id: o.id, status: In(["pending", "expired"]) },
          {
            fulfillment: "requires_review",
            reason: "Manual reconciliation required",
          },
        );
        this.logger.warn(`Manual reconciliation required ref=${o.txnRef}`);
        continue;
      }
      try {
        const endpoint = this.config.getOrThrow<string>("VNPAY_API_URL");
        if (
          endpoint !==
          "https://sandbox.vnpayment.vn/merchant_webapi/api/transaction"
        )
          continue;
        const data = queryRequest(
          o,
          this.config.getOrThrow("VNPAY_TMN_CODE"),
          this.secret(),
          this.config.get<string>("VNPAY_QUERY_IP") ?? "127.0.0.1",
        );
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) {
          this.logger.warn(
            `Query retry ref=${o.txnRef} http=${response.status}`,
          );
          continue;
        }
        const raw: unknown = await response.json();
        const p = verifiedQueryResponse(raw, data, this.secret());
        if (!p) {
          const code =
            raw &&
            typeof raw === "object" &&
            "vnp_ResponseCode" in raw &&
            /^\d{2}$/.test(String(raw.vnp_ResponseCode))
              ? raw.vnp_ResponseCode
              : "unknown";
          this.logger.warn(
            `Query unverified ref=${o.txnRef} request=${data.vnp_RequestId} code=${code}`,
          );
          continue;
        }
        const event: Record<string, string> = {
          vnp_TmnCode: p.vnp_TmnCode,
          vnp_TxnRef: p.vnp_TxnRef,
          vnp_Amount: p.vnp_Amount,
          vnp_ResponseCode: p.vnp_TransactionStatus === "00" ? "00" : "99",
          vnp_TransactionStatus: p.vnp_TransactionStatus,
          vnp_TransactionNo: p.vnp_TransactionNo ?? "",
        };
        event.vnp_SecureHash = sign(event, this.secret());
        await this.ipn(event);
      } catch {
        this.logger.warn(`Query retry ref=${o.txnRef} network_or_format_error`);
      }
    }
  }
}
