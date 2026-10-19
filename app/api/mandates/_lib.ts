// Shared helpers for /api/mandates/* (architecture §9, §13).

import { getSessionUserId } from "@/src/server/auth/session";
import { withUserTx } from "@/src/server/db/pool";
import { jsonError } from "@/src/server/db/read/http";
import type { BaseCurrency } from "@/src/server/mandate/schema";

export async function sessionOr401(request: Request): Promise<string | Response> {
  const userId = await getSessionUserId(request);
  return userId ?? jsonError(401, "unauthorized");
}

export function baseCurrencyOf(userId: string): Promise<BaseCurrency> {
  return withUserTx(userId, async (tx) => {
    const r = await tx.query<{ base_currency: BaseCurrency }>("select base_currency from public.users where id = $1", [userId]);
    return r.rows[0]?.base_currency ?? "CNY";
  });
}

export const internal = (msg: string, e: unknown) => {
  console.error(JSON.stringify({ msg, error: e instanceof Error ? e.message : String(e) }));
  return jsonError(500, "internal");
};
