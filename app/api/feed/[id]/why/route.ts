// Owner: R2 (roles.md).
// GET /api/feed/:id/why (architecture §13): the stored decision trace for one feed item, the
// "Rule check" in plain words. Built from the action's stored Gate result (rule ids, decision,
// trace), never from LLM text. Owner only: another user's id is a 404. REINS_FIXTURES=1 serves
// the entry for that id in fixtures/api/feed-why.json.

import fixtures from "@/fixtures/api/feed-why.json";
import type { FeedWhyResponse } from "@/src/server/api-types";
import { isUuid } from "@/src/server/auth/session";
import { jsonError, readRoute } from "@/src/server/db/read/http";
import { loadWhy } from "@/src/server/db/read/feed-repo";

const notFound = () => jsonError(404, "feed item not found", "not_found");

export async function GET(req: Request, ctx: RouteContext<"/api/feed/[id]/why">): Promise<Response> {
  const { id } = await ctx.params;
  return readRoute<FeedWhyResponse>(
    req,
    () => (Object.hasOwn(fixtures, id) ? (fixtures as Record<string, FeedWhyResponse>)[id]! : notFound()),
    async (d) => {
      if (!isUuid(id)) return notFound();
      // loadWhy is per user (RLS plus the user filter), so a foreign id finds nothing.
      return (await loadWhy(d.userId, id)) ?? notFound();
    },
  );
}
