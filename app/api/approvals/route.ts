// Owner: R2 (roles.md). Minimal version by R1; extend, don't duplicate.
// GET /api/approvals?status=pending (architecture §8.3, §13): the session user's pending,
// unexpired approval cards. Cards are built from actions.args_json and registry names only.
// No `runtime` export: cacheComponents is on, and Node is the default runtime.

import fixture from "@/fixtures/api/approvals.json";
import { getSessionUserId } from "@/src/server/auth/session";
import { fixturesEnabled } from "@/src/server/db/read/http";
import { listPendingCards, type ApprovalsResponse } from "./_lib/cards";

type ErrorBody = { error: string };
const json = (body: ApprovalsResponse | ErrorBody, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

export async function GET(request: Request): Promise<Response> {
  // REINS_FIXTURES=1 serves fixtures/api/approvals.json, like the read routes (no DB, no session).
  if (fixturesEnabled()) return json(fixture as ApprovalsResponse);
  const userId = await getSessionUserId(request);
  if (!userId) return json({ error: "unauthorized" }, 401);

  const status = new URL(request.url).searchParams.get("status") ?? "pending";
  if (status !== "pending") return json({ error: "only status=pending is supported" }, 400);

  try {
    return json({ items: await listPendingCards(userId) });
  } catch (e) {
    console.error(JSON.stringify({ msg: "approvals list failed", error: e instanceof Error ? e.message : String(e) }));
    return json({ error: "internal" }, 500);
  }
}
