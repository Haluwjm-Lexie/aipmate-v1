import { createHmac, timingSafeEqual } from "node:crypto";
export function equal(a, b) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
const sign = (v, key) =>
  createHmac("sha256", key).update(v).digest("base64url");
export function issueSession(secret, now = Date.now()) {
  const exp = String(now + 8 * 3600 * 1000);
  return exp + "." + sign(exp, secret);
}
export function verifySession(token, secret, now = Date.now()) {
  if (!token || !secret) return false;
  const [exp, sig, ...rest] = token.split(".");
  return (
    !rest.length &&
    Number.isFinite(+exp) &&
    +exp > now &&
    +exp <= now + 8 * 3600 * 1000 &&
    equal(sig || "", sign(exp, secret))
  );
}
export function validOrigin(origin, host) {
  try {
    return (
      !!origin &&
      new URL(origin).host === host &&
      ["http:", "https:"].includes(new URL(origin).protocol)
    );
  } catch {
    return false;
  }
}
// Personal, loopback-bound workspace: no password gate. Same-origin checks remain.
export function authenticated(_req) {
  return true;
}
