import { createHmac } from "node:crypto";
import {
  queryRequest,
  verifiedQueryResponse,
  queryResponseFields,
} from "../../src/modules/payments/querydr";
const secret = "test-secret";
const order = {
  txnRef: "a".repeat(32),
  paymentUrl:
    "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?vnp_CreateDate=20261031200000",
  transactionNo: null,
};
it("uses documented querydr pipe order and Vietnam time", () => {
  const p = queryRequest(
    order,
    "MERCHANT",
    secret,
    "127.0.0.1",
    new Date("2026-10-31T17:00:00Z"),
  );
  expect(p.vnp_CreateDate).toBe("20261101000000");
  expect(p.vnp_SecureHash).toBe(
    createHmac("sha512", secret)
      .update(
        `${p.vnp_RequestId}|2.1.0|querydr|MERCHANT|${order.txnRef}|20261031200000|20261101000000|127.0.0.1|Query ${order.txnRef}`,
      )
      .digest("hex"),
  );
});
it("requires response signature and matching merchant, reference, type and command", () => {
  const req = queryRequest(order, "MERCHANT", secret, "127.0.0.1");
  const p: Record<string, string> = {
    vnp_ResponseId: "id",
    vnp_Command: "querydr",
    vnp_ResponseCode: "00",
    vnp_Message: "ok",
    vnp_TmnCode: "MERCHANT",
    vnp_TxnRef: order.txnRef,
    vnp_Amount: "1000000",
    vnp_TransactionType: "01",
    vnp_TransactionStatus: "00",
  };
  const signed = (v: Record<string, string>) => ({
    ...v,
    vnp_SecureHash: createHmac("sha512", secret)
      .update(queryResponseFields.map((k) => v[k] ?? "").join("|"))
      .digest("hex"),
  });
  expect(verifiedQueryResponse(signed(p), req, secret)).not.toBeNull();
  const changes: Record<string,string>[] = [
    { vnp_TmnCode: "OTHER" },
    { vnp_TxnRef: "wrong" },
    { vnp_Command: "refund" },
    { vnp_TransactionType: "02" },
    { vnp_ResponseCode: "99" },
  ];
  for (const change of changes)
    expect(
      verifiedQueryResponse(signed({ ...p, ...change }), req, secret),
    ).toBeNull();
  expect(
    verifiedQueryResponse({ ...signed(p), vnp_Amount: "1" }, req, secret),
  ).toBeNull();
  expect(
    verifiedQueryResponse({ vnp_ResponseCode: "99" }, req, secret),
  ).toBeNull();
  expect(verifiedQueryResponse(null, req, secret)).toBeNull();
});
