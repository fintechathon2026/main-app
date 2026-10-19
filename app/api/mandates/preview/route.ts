// Owner: R2 (roles.md). POST /api/mandates/preview {draft} : the editor's structured draft
// (no LLM) -> complete policy with restrictive defaults, read-back, diff and change class.

import { hashPolicy } from "@/src/core/mandate/canonical";
import { jsonError } from "@/src/server/db/read/http";
import { readback } from "@/src/server/mandate/readback";
import { PolicyDraft, withDefaults } from "@/src/server/mandate/schema";
import { previewAgainstActive } from "@/src/server/mandate/store";
import { baseCurrencyOf, internal, sessionOr401 } from "../_lib";

export async function POST(request: Request): Promise<Response> {
  const userId = await sessionOr401(request);
  if (userId instanceof Response) return userId;
  let draft: PolicyDraft;
  try {
    const raw = (await request.json()) as { draft?: unknown };
    draft = PolicyDraft.parse(raw.draft);
  } catch {
    return jsonError(400, "draft does not match the mandate schema", "bad_draft");
  }
  try {
    const { policy, defaulted } = withDefaults(draft, await baseCurrencyOf(userId));
    const p = await previewAgainstActive(userId, policy);
    return Response.json({ candidate: policy, policyHash: hashPolicy(policy), defaulted, readback: readback(policy), ...p });
  } catch (e) {
    return internal("mandate preview failed", e);
  }
}
