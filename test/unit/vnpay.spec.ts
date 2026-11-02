/**
 * MODULE: PAYMENTS & PROMOTIONS
 *
 * WORD TEST CASES:
 * - TC-VNP-01: Chuẩn hóa field có encode, loại checksum khỏi chữ ký, ký HMAC SHA512
 * - TC-VNP-02: Định dạng mốc nửa đêm theo giờ Việt Nam, độc lập timezone máy chạy
 * - TC-VNP-03: Từ chối: invalid signatures and duplicate query parameters before database access
 * - TC-VNP-04: Xác nhận return từ chối dữ liệu bị can thiệp trước khi kiểm tra sở hữu/giao hàng
 * - TC-VNP-05: Return hợp lệ kiểm tra chủ sở hữu trước khi chạy fulfillment dùng chung trong transaction
 * - TC-VNP-06: Cung cấp đúng dependency PromotionEligibilityService cho Nest injection
 */

jest.mock("@nestjs/schedule", () => ({ Cron: () => () => {} }));
import {
  canonical,
  sign,
  verify,
  vnDate,
} from "../../src/modules/payments/vnpay";
import { createHmac } from "node:crypto";
import { PaymentsService } from "../../src/modules/payments/payments.service";
import { ConfigService } from "@nestjs/config";
// [WORD-TC: TC-VNP-01]
// Chức năng: Chuẩn hóa field có encode, loại checksum khỏi chữ ký, ký HMAC SHA512
it("[TC-VNP-01] Chuẩn hóa field có encode, loại checksum khỏi chữ ký, ký HMAC SHA512", () => {
  const p = {
    vnp_TxnRef: "a",
    vnp_OrderInfo: "Day tin +",
    vnp_SecureHash: "ignored",
  };
  expect(canonical(p)).toBe("vnp_OrderInfo=Day+tin+%2B&vnp_TxnRef=a");
  const hash = createHmac("sha512", "test")
    .update("vnp_OrderInfo=Day+tin+%2B&vnp_TxnRef=a")
    .digest("hex");
  expect(sign(p, "test")).toBe(hash);
  expect(verify({ ...p, vnp_SecureHash: hash }, "test")).toBe(true);
  expect(
    verify({ ...p, vnp_SecureHash: hash, vnp_TxnRef: "changed" }, "test"),
  ).toBe(false);
  expect(verify({ ...p, vnp_SecureHash: "bad" }, "test")).toBe(false);
});
// [WORD-TC: TC-VNP-02]
// Chức năng: Định dạng mốc nửa đêm theo giờ Việt Nam, độc lập timezone máy chạy
it("[TC-VNP-02] Định dạng mốc nửa đêm theo giờ Việt Nam, độc lập timezone máy chạy", () =>
  expect(vnDate(new Date("2026-10-31T17:00:00Z"))).toBe("20261101000000"));
// [WORD-TC: TC-VNP-03]
// Chức năng: Từ chối: invalid signatures and duplicate query parameters before database access
it("[TC-VNP-03] Từ chối: invalid signatures and duplicate query parameters before database access", async () => {
  const repo = jest.fn();
  const s = new PaymentsService(
    { getRepository: repo } as never,
    new ConfigService({
      VNPAY_HASH_SECRET: "secret",
      VNPAY_TMN_CODE: "merchant",
    }),
  );
  expect((await s.ipn({ vnp_TxnRef: ["one", "two"] })).RspCode).toBe("97");
  expect((await s.ipn({ vnp_SecureHash: "wrong" })).RspCode).toBe("97");
  expect(repo).not.toHaveBeenCalled();
  expect(s.packages().map((p) => p.amount)).toEqual([10000, 18000, 24000]);
});

// [WORD-TC: TC-VNP-04]
// Chức năng: Xác nhận return từ chối dữ liệu bị can thiệp trước khi kiểm tra sở hữu/giao hàng
it("[TC-VNP-04] Xác nhận return từ chối dữ liệu bị can thiệp trước khi kiểm tra sở hữu/giao hàng", async()=>{
 const s=new PaymentsService({} as never,new ConfigService({VNPAY_HASH_SECRET:"secret",VNPAY_TMN_CODE:"merchant"}));
 const read=jest.spyOn(s,"read"),ipn=jest.spyOn(s,"ipn");
 const params:Record<string,string>={vnp_TxnRef:"a".repeat(32),vnp_TmnCode:"merchant",vnp_Amount:"1000000",vnp_ResponseCode:"00",vnp_TransactionStatus:"00"};
 params.vnp_SecureHash=sign(params,"secret");
 await expect(s.confirmReturn("owner",{...params,vnp_Amount:"1"})).rejects.toMatchObject({status:400});
 expect(read).not.toHaveBeenCalled();expect(ipn).not.toHaveBeenCalled();
});
// [WORD-TC: TC-VNP-05]
// Chức năng: Return hợp lệ kiểm tra chủ sở hữu trước khi chạy fulfillment dùng chung trong transaction
it("[TC-VNP-05] Return hợp lệ kiểm tra chủ sở hữu trước khi chạy fulfillment dùng chung trong transaction", async()=>{
 const s=new PaymentsService({} as never,new ConfigService({VNPAY_HASH_SECRET:"secret",VNPAY_TMN_CODE:"merchant"}));
 const params:Record<string,string>={vnp_TxnRef:"b".repeat(32),vnp_TmnCode:"merchant",vnp_Amount:"1000000",vnp_ResponseCode:"00",vnp_TransactionStatus:"00"};params.vnp_SecureHash=sign(params,"secret");
 const read=jest.spyOn(s,"read").mockRejectedValueOnce(new Error("not owner"));const ipn=jest.spyOn(s,"ipn").mockResolvedValue({RspCode:"00",Message:"success"});
 await expect(s.confirmReturn("other",params)).rejects.toThrow("not owner");expect(ipn).not.toHaveBeenCalled();
 read.mockResolvedValue({id:"order",status:"paid",fulfillment:"active"} as never);
 await expect(s.confirmReturn("owner",params)).resolves.toMatchObject({status:"paid",fulfillment:"active"});expect(ipn).toHaveBeenCalledWith(params);
});

// [WORD-TC: TC-VNP-06]
// Chức năng: Cung cấp đúng dependency PromotionEligibilityService cho Nest injection
it("[TC-VNP-06] Cung cấp đúng dependency PromotionEligibilityService cho Nest injection", ()=>{ expect(Reflect.getMetadata("design:paramtypes",PaymentsService)[2].name).toBe("PromotionEligibilityService"); });
