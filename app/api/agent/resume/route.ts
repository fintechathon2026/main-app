// POST /api/agent/resume { planId } (architecture §6.6, §13). Resumes a paused plan after the
// user decided on its approval. The body carries only the plan id: never a userId and never an
// approval status (H2, T19). Ownership is checked against plans.user_id before resuming.
// No `runtime` export: Node.js is the default and the segment config is rejected under
// cacheComponents in Next.js 16.

import { z } from "zod";
import { PlanNotFoundError, resumePlan } from "@/src/agent/run";
import type { ApiError, ResumeResponse } from "@/src/server/api-types";
import { getSessionUserId } from "@/src/server/auth/session";

const ResumeBody = z.object({ planId: z.uuid() }).strict();

const json = (body: ResumeResponse | ApiError, status = 200) => Response.json(body, { status });

export async function POST(request: Request): Promise<Response> {
  const userId = await getSessionUserId(request);
  if (!userId) return json({ error: "unauthorized" }, 401);

  let planId: string;
  try {
    planId = ResumeBody.parse(await request.json()).planId;
  } catch {
    return json({ error: "invalid body", code: "bad_request" }, 400);
  }

  try {
    return json(await resumePlan({ planId, userId }));
  } catch (e) {
    if (e instanceof PlanNotFoundError) return json({ error: "not found" }, 404);
    console.error(JSON.stringify({ msg: "resume failed", planId, error: e instanceof Error ? e.message : String(e) }));
    return json({ error: "resume failed" }, 500);
  }
}
