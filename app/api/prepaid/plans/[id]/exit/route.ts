// Owner: R2 (roles.md). POST /api/prepaid/plans/:id/exit {deadline, consumerSig} (architecture §13,
// §24.10): the owner's voluntary exit (fee applies). Unused money minus the capped fee goes back to
// the owner; the escrow takes no recipient.

import { getSessionUserId, isUuid } from "@/src/server/auth/session";
import { ExitBody, exitVoluntary } from "@/src/server/prepaid/user-actions";
import { actionResult, err, userActionError } from "../../../_lib";

export async function POST(request: Request, ctx: RouteContext<"/api/prepaid/plans/[id]/exit">): Promise<Response> {
  const userId = await getSessionUserId(request);
  if (!userId) return err(401, "unauthorized");
  const { id } = await ctx.params;
  if (!isUuid(id)) return err(404, "not found", "not_found");
  const body = ExitBody.safeParse(await request.json().catch(() => null));
  if (!body.success) return err(400, "invalid body", "bad_request");
  try {
    return actionResult(await exitVoluntary(userId, id, body.data));
  } catch (e) {
    return userActionError(e, "prepaid exit");
  }
}
