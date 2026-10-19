// Owner: R2 (roles.md). GET /api/audit/verify: walk the user's hash chain (architecture §13, G7).

import { connection } from "next/server";
import { verifyAuditChain } from "@/src/server/audit";
import { getSessionUserId } from "@/src/server/auth/session";
import { fixturesEnabled, jsonError } from "@/src/server/db/read/http";

export async function GET(request: Request): Promise<Response> {
  await connection();
  if (fixturesEnabled()) return Response.json({ ok: true, count: 42, firstBreakSeq: null });
  const userId = await getSessionUserId(request);
  if (!userId) return jsonError(401, "unauthorized");
  try {
    return Response.json(await verifyAuditChain(userId), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error(JSON.stringify({ msg: "audit verify failed", error: e instanceof Error ? e.message : String(e) }));
    return jsonError(500, "internal");
  }
}
