// POST /api/subscriptions/:id/keep — the user's one-tap "keep it" on a trial (FR5.7). Sets
// `keep_flag` so the Gate refuses a T3 auto-cancel. Owner only (user_id filter + RLS); no money
// moves. TODO(audit): append an audit_log event once R2's audit append is available.

import type { KeepTrialResponse } from "@/src/server/api-types";
import { jsonError, readRoute } from "@/src/server/db/read/http";

export async function POST(req: Request, ctx: RouteContext<"/api/subscriptions/[id]/keep">): Promise<Response> {
  const { id } = await ctx.params;
  return readRoute<KeepTrialResponse>(
    req,
    () => ({ subscriptionId: id, keepFlag: true }),
    async (d) => {
      if (!id || id.length > 128) return jsonError(400, "bad id", "bad_id");
      const r = await d.repos.keepTrial(d.userId, id);
      if (r === "not_found") return jsonError(404, "subscription not found", "not_found");
      if (r === "not_trial") return jsonError(409, "only a trial can be kept", "not_trial");
      return { subscriptionId: id, keepFlag: true };
    },
  );
}
