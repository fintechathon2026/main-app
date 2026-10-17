// Owner: R2 (roles.md). Minimal version by R1; extend, don't duplicate.
// POST /api/approvals/:id {decision: "approve"|"reject", reason?} (architecture §8.3 steps 2–3).
// The session user must own the approval, it must be pending and unexpired (decideApproval,
// in Postgres). Then the plan is resumed internally; the resume carries no authority: the
// executor reads the approval row again and consumes it exactly once (G3).
// R1 adds the WebAuthn assertion over action_hash to this body; until then it is rejected.
// No `runtime` export: cacheComponents is on, and Node is the default runtime.

import { z } from "zod";
import { resumePlan } from "@/src/agent/run";
import type { ResumeResponse } from "@/src/server/api-types";
import { ApprovalError, decideApproval } from "@/src/server/approvals";
import { getSessionUserId, isUuid } from "@/src/server/auth/session";
import { planIdForAction, type DecisionResponse } from "../_lib/cards";

const DecisionBody = z
  .object({
    decision: z.enum(["approve", "reject"]),
    reason: z.string().trim().max(280).optional(),
  })
  .strict();

type ErrorBody = { error: string; code?: string };
const json = (body: DecisionResponse | ErrorBody, status = 200) => Response.json(body, { status });

const ERROR_STATUS: Record<ApprovalError["code"], number> = {
  not_found: 404, // includes another user's approval: no existence leak
  not_pending: 409, // already approved, rejected, consumed or expired
  expired: 410,
  action_not_awaiting: 409,
};

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const userId = await getSessionUserId(request);
  if (!userId) return json({ error: "unauthorized" }, 401);

  const { id } = await ctx.params;
  if (!isUuid(id)) return json({ error: "not found", code: "not_found" }, 404);

  let body: z.infer<typeof DecisionBody>;
  try {
    body = DecisionBody.parse(await request.json());
  } catch {
    return json({ error: "invalid body", code: "bad_request" }, 400);
  }

  let decided: Awaited<ReturnType<typeof decideApproval>>;
  try {
    decided = await decideApproval(userId, id, body.decision, body.reason || undefined);
  } catch (e) {
    if (e instanceof ApprovalError) return json({ error: e.code.replaceAll("_", " "), code: e.code }, ERROR_STATUS[e.code]);
    console.error(JSON.stringify({ msg: "approval decide failed", approvalId: id, error: e instanceof Error ? e.message : String(e) }));
    return json({ error: "internal" }, 500);
  }

  // Resume the plan so it reaches `execute` (approve) or finishes (reject). A failed resume
  // does not undo the decision; the plan can be resumed again via /api/agent/resume.
  let planId: string | null = null;
  let resume: ResumeResponse | null = null;
  try {
    planId = await planIdForAction(userId, decided.actionId);
    if (planId) resume = await resumePlan({ planId, userId });
  } catch (e) {
    console.error(JSON.stringify({ msg: "approval resume failed", approvalId: id, planId, error: e instanceof Error ? e.message : String(e) }));
  }
  return json({ approvalId: decided.approvalId, status: decided.status, planId, resume });
}
