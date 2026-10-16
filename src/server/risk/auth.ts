// Cron authorization (architecture §11.1): `Authorization: Bearer ${CRON_SECRET}`, compared in
// constant time. No secret configured: every request is rejected.

import { createHash, timingSafeEqual } from "node:crypto";

const digest = (s: string) => createHash("sha256").update(s).digest();

export function cronAuthorized(req: Request, secret = process.env.CRON_SECRET): boolean {
  if (!secret) return false;
  const got = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "")?.[1]?.trim() ?? "";
  return timingSafeEqual(digest(got), digest(secret)) && got.length === secret.length;
}
