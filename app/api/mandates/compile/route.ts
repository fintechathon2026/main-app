// Owner: R2 (roles.md). POST /api/mandates/compile {text} (architecture §9.1, §13): natural
// language -> candidate policy, template read-back, diff and change class against the active
// version. Nothing is activated here; the user signs via /api/mandates/activate.

import { z } from "zod";
import { hashPolicy } from "@/src/core/mandate/canonical";
import { getAgentDeps } from "@/src/agent/wiring";
import { jsonError } from "@/src/server/db/read/http";
import { MAX_MANDATE_TEXT, MandateCompileError, compile } from "@/src/server/mandate/compile";
import { previewAgainstActive } from "@/src/server/mandate/store";
import { baseCurrencyOf, internal, sessionOr401 } from "../_lib";

const Body = z.object({ text: z.string().trim().min(1).max(MAX_MANDATE_TEXT) }).strict();

export async function POST(request: Request): Promise<Response> {
  const userId = await sessionOr401(request);
  if (userId instanceof Response) return userId;
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch {
    return jsonError(400, "invalid body", "bad_request");
  }
  try {
    const r = await compile(body.text, { models: getAgentDeps().models, baseCurrency: await baseCurrencyOf(userId) });
    const p = await previewAgainstActive(userId, r.policy);
    return Response.json({ candidate: r.policy, policyHash: hashPolicy(r.policy), defaulted: r.defaulted, readback: r.readback, ...p });
  } catch (e) {
    if (e instanceof MandateCompileError) return jsonError(422, e.message, "compile_failed");
    return internal("mandate compile failed", e);
  }
}
