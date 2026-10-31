import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { vnDate } from "./vnpay";
const requestFields = [
  "vnp_RequestId",
  "vnp_Version",
  "vnp_Command",
  "vnp_TmnCode",
  "vnp_TxnRef",
  "vnp_TransactionDate",
  "vnp_CreateDate",
  "vnp_IpAddr",
  "vnp_OrderInfo",
];
export const queryResponseFields = [
  "vnp_ResponseId",
  "vnp_Command",
  "vnp_ResponseCode",
  "vnp_Message",
  "vnp_TmnCode",
  "vnp_TxnRef",
  "vnp_Amount",
  "vnp_BankCode",
  "vnp_PayDate",
  "vnp_TransactionNo",
  "vnp_TransactionType",
  "vnp_TransactionStatus",
  "vnp_OrderInfo",
  "vnp_PromotionCode",
  "vnp_PromotionAmount",
];
export function queryRequest(
  order: { txnRef: string; paymentUrl: string; transactionNo: string | null },
  merchant: string,
  secret: string,
  ip: string,
  now = new Date(),
) {
  const date = new URL(order.paymentUrl).searchParams.get("vnp_CreateDate");
  if (!/^\d{14}$/.test(date ?? "")) throw new Error("Missing checkout date");
  const p: Record<string, string> = {
    vnp_RequestId: randomUUID().replace(/-/g, ""),
    vnp_Version: "2.1.0",
    vnp_Command: "querydr",
    vnp_TmnCode: merchant,
    vnp_TxnRef: order.txnRef,
    vnp_TransactionDate: date!,
    vnp_CreateDate: vnDate(now),
    vnp_IpAddr: ip,
    vnp_OrderInfo: `Query ${order.txnRef}`,
  };
  if (order.transactionNo) p.vnp_TransactionNo = order.transactionNo;
  p.vnp_SecureHash = createHmac("sha512", secret)
    .update(requestFields.map((k) => p[k]).join("|"))
    .digest("hex");
  return p;
}
export function verifiedQueryResponse(
  input: unknown,
  request: Record<string, string>,
  secret: string,
): Record<string, string> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const p = input as Record<string, string>;
  if (
    queryResponseFields.some(
      (k) => p[k] !== undefined && typeof p[k] !== "string",
    ) ||
    !/^[a-fA-F0-9]{128}$/.test(p.vnp_SecureHash ?? "")
  )
    return null;
  const hash = createHmac("sha512", secret)
    .update(queryResponseFields.map((k) => p[k] ?? "").join("|"))
    .digest();
  if (
    !timingSafeEqual(hash, Buffer.from(p.vnp_SecureHash, "hex")) ||
    p.vnp_Command !== "querydr" ||
    p.vnp_ResponseCode !== "00" ||
    p.vnp_TransactionType !== "01" ||
    p.vnp_TmnCode !== request.vnp_TmnCode ||
    p.vnp_TxnRef !== request.vnp_TxnRef ||
    !/^\d{2}$/.test(p.vnp_TransactionStatus ?? "")
  )
    return null;
  return p;
}
