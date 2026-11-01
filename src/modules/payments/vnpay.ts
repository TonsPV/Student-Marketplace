import { createHmac, timingSafeEqual } from "node:crypto";
export function canonical(params: Record<string, string>): string {
  return Object.keys(params)
    .filter(
      (k) =>
        k !== "vnp_SecureHash" &&
        k !== "vnp_SecureHashType" &&
        params[k] !== "",
    )
    .sort()
    .map(
      (k) =>
        `${encodeURIComponent(k)}=${encodeURIComponent(params[k]).replace(/%20/g, "+")}`,
    )
    .join("&");
}
export function sign(params: Record<string, string>, secret: string): string {
  return createHmac("sha512", secret).update(canonical(params)).digest("hex");
}
export function verify(
  params: Record<string, string>,
  secret: string,
): boolean {
  const hash = params.vnp_SecureHash;
  return (
    typeof hash === "string" &&
    /^[a-fA-F0-9]{128}$/.test(hash) &&
    timingSafeEqual(
      Buffer.from(hash, "hex"),
      Buffer.from(sign(params, secret), "hex"),
    )
  );
}
export function vnDate(date: Date): string {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (key: string) => p.find((v) => v.type === key)!.value;
  return ["year", "month", "day", "hour", "minute", "second"].map(get).join("");
}
