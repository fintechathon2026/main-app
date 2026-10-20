// Owner: R3 (roles.md). POST /api/prepaid/gym/checkin/:planId : demo stand-in for scanning the gym
// tablet's QR. Only for the user's own active plan; the tablet signs the plan's next session.

import { getSessionUserId, isUuid } from "@/src/server/auth/session";
import { withUserTx } from "@/src/server/db/pool";
import { GymError, gymCheckin } from "@/src/server/prepaid/gym-client";
import { err, noStore } from "../../../_lib";

export async function POST(request: Request, ctx: RouteContext<"/api/prepaid/gym/checkin/[planId]">): Promise<Response> {
  const userId = await getSessionUserId(request);
  if (!userId) return err(401, "unauthorized");
  const { planId } = await ctx.params;
  if (!isUuid(planId)) return err(404, "not found", "not_found");
  const chainPlanId = await withUserTx(userId, async (tx) => {
    const r = await tx.query("select chain_plan_id::text as id from public.prepaid_plans where id = $1 and user_id = $2 and status = 'active'", [planId, userId]);
    return r.rows[0]?.id as string | undefined;
  });
  if (!chainPlanId) return err(404, "not found", "not_found");
  try {
    return Response.json(await gymCheckin(chainPlanId), { headers: noStore });
  } catch (e) {
    return err(502, "the gym tablet did not sign", e instanceof GymError ? `gym_${e.status}` : "gym_unavailable");
  }
}
