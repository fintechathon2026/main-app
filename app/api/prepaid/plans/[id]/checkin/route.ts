// Owner: R2 (roles.md). POST /api/prepaid/plans/:id/checkin {sessionNo, deadline, consumerSig,
// merchantSig} (architecture §13, §24.10). Both signatures over the same Redeem; the Gate checks
// the session is the plan's next one and both signers, then the escrow releases one session price.

import { getSessionUserId, isUuid } from "@/src/server/auth/session";
import { CheckinBody, checkin } from "@/src/server/prepaid/user-actions";
import { actionResult, err, userActionError } from "../../../_lib";

export async function POST(request: Request, ctx: RouteContext<"/api/prepaid/plans/[id]/checkin">): Promise<Response> {
  const userId = await getSessionUserId(request);
  if (!userId) return err(401, "unauthorized");
  const { id } = await ctx.params;
  if (!isUuid(id)) return err(404, "not found", "not_found");
  const body = CheckinBody.safeParse(await request.json().catch(() => null));
  if (!body.success) return err(400, "invalid body", "bad_request");
  try {
    return actionResult(await checkin(userId, id, body.data));
  } catch (e) {
    return userActionError(e, "prepaid checkin");
  }
}
