// Owner: R3 (roles.md). Minimal version by R1; extend, don't duplicate.
// SIM_API_KEY check for the simulator routes (architecture §13, §24.7). Constant-time compare.
// The simulators are an outside party: this file imports nothing from the server.

import { createHash, timingSafeEqual } from "node:crypto";

function bearer(req: Request): string {
  return /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "")?.[1]?.trim() ?? "";
}

/** Constant-time equality over SHA-256 digests (no length leak). */
export function safeEqual(a: string, b: string): boolean {
  const da = createHash("sha256").update(a).digest();
  const db = createHash("sha256").update(b).digest();
  return timingSafeEqual(da, db) && a.length === b.length;
}

/** Admin endpoints (publish): SIM_API_KEY must be set and presented as a bearer token. */
export function simAdminOk(req: Request, key = process.env.SIM_API_KEY): boolean {
  if (!key) return false;
  return safeEqual(bearer(req), key);
}

/**
 * Read endpoints: SIM_API_KEY bearer when the key is configured. Without a key, reads are open
 * only outside production (local demo).
 */
export function simReadOk(req: Request, key = process.env.SIM_API_KEY, nodeEnv = process.env.NODE_ENV): boolean {
  if (!key) return nodeEnv !== "production";
  return safeEqual(bearer(req), key);
}
