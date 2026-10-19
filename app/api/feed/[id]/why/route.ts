// Owner: R2 (roles.md). GET /api/feed/:id/why (architecture §13, G7): Gate trace and the audit
// rows for one action. Owner only (user filter + RLS); another user's id is a 404.

import { connection } from "next/server";
import fixture from "@/fixtures/api/feed-why.json";
import { getSessionUserId, isUuid } from "@/src/server/auth/session";
import { fixturesEnabled, jsonError } from "@/src/server/db/read/http";
import { whyFor, type WhyResponse } from "@/src/server/feed";

export async function GET(request: Request, ctx: RouteContext<"/api/feed/[id]/why">): Promise<Response> {
  await connection();
  const { id } = await ctx.params;
  if (fixturesEnabled()) {
    const f = fixture as WhyResponse;
    return f.item.id === id ? Response.json(f) : jsonError(404, "not found", "not_found");
  }
  const userId = await getSessionUserId(request);
  if (!userId) return jsonError(401, "unauthorized");
  if (!isUuid(id)) return jsonError(404, "not found", "not_found");
  try {
    const why = await whyFor(userId, id);
    return why ? Response.json(why, { headers: { "cache-control": "no-store" } }) : jsonError(404, "not found", "not_found");
  } catch (e) {
    console.error(JSON.stringify({ msg: "why failed", error: e instanceof Error ? e.message : String(e) }));
    return jsonError(500, "internal");
  }
}
