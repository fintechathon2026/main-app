// Owner: R2 (roles.md). GET /api/feed (architecture §13): activity feed from action rows.
// No `runtime` export: cacheComponents is on, and Node is the default runtime.

import { connection } from "next/server";
import fixture from "@/fixtures/api/feed.json";
import { getSessionUserId } from "@/src/server/auth/session";
import { fixturesEnabled, jsonError } from "@/src/server/db/read/http";
import { listFeed, type FeedResponse } from "@/src/server/feed";

export async function GET(request: Request): Promise<Response> {
  await connection();
  if (fixturesEnabled()) return Response.json(fixture as FeedResponse);
  const userId = await getSessionUserId(request);
  if (!userId) return jsonError(401, "unauthorized");
  try {
    return Response.json(await listFeed(userId), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error(JSON.stringify({ msg: "feed failed", error: e instanceof Error ? e.message : String(e) }));
    return jsonError(500, "internal");
  }
}
