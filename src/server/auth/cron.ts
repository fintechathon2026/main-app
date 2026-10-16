// Cron route auth (architecture §11.1): `Authorization: Bearer ${CRON_SECRET}`, compared in
// constant time. An unset or short secret refuses every request.

import { createHash, timingSafeEqual } from "node:crypto";

const MIN_SECRET_LENGTH = 16;

export function verifyCronAuth(req: Request, secret: string | undefined = process.env.CRON_SECRET): boolean {
  if (!secret || secret.length < MIN_SECRET_LENGTH) return false;
  const header = req.headers.get("authorization") ?? "";
  const m = /^Bearer (.+)$/.exec(header);
  if (!m) return false;
  // Hash both sides so lengths match and the comparison time does not depend on the input.
  const a = createHash("sha256").update(m[1]).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}
