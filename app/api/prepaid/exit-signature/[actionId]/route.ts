// Owner: R2 (roles.md). POST /api/prepaid/exit-signature/:actionId {deadline, consumerSig}: the
// owner's VoluntaryExit signature for an agent-proposed prepaid_exit that has no attestation, so
// one approval can then confirm it (architecture §24.5, Gate prepaid.exit_needs_confirm).

import { getSessionUserId, isUuid } from "@/src/server/auth/session";
import { ExitSignatureError, recordVoluntaryExitSignature } from "@/src/server/prepaid/exit-signature";
import { err, noStore } from "../../_lib";

const STATUS: Record<ExitSignatureError["code"], number> = {
  not_found: 404,
  wrong_tool: 409,
  action_not_open: 409,
  invalid: 400,
  expired: 410,
  signature_invalid: 422,
};

export async function POST(request: Request, ctx: RouteContext<"/api/prepaid/exit-signature/[actionId]">): Promise<Response> {
  const userId = await getSessionUserId(request);
  if (!userId) return err(401, "unauthorized");
  const { actionId } = await ctx.params;
  if (!isUuid(actionId)) return err(404, "not found", "not_found");
  try {
    return Response.json(await recordVoluntaryExitSignature(userId, actionId, await request.json().catch(() => null)), { headers: noStore });
  } catch (e) {
    if (e instanceof ExitSignatureError) return err(STATUS[e.code], e.code.replaceAll("_", " "), e.code);
    console.error(JSON.stringify({ msg: "exit signature failed", error: e instanceof Error ? e.message : String(e) }));
    return err(500, "internal");
  }
}
