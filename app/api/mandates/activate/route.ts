// Owner: R2 (roles.md). POST /api/mandates/activate (architecture §9.1, §13). The user signs the
// exact candidate they reviewed: its hash and the active version it was diffed against must
// match. Widening changes need confirmWidening (passkey in R1). The agent has no path here (G6).

import { z } from "zod";
import { jsonError } from "@/src/server/db/read/http";
import { PolicyDraft, withDefaults } from "@/src/server/mandate/schema";
import { MandateActivateError, activateMandate } from "@/src/server/mandate/store";
import { baseCurrencyOf, internal, sessionOr401 } from "../_lib";

const Body = z
  .object({
    candidate: z.record(z.string(), z.unknown()),
    policyHash: z.string().regex(/^[0-9a-f]{64}$/),
    baseVersion: z.number().int().positive().nullable(),
    createdVia: z.enum(["nl", "edit", "template"]),
    confirmWidening: z.boolean().default(false),
  })
  .strict();

const STATUS: Record<MandateActivateError["code"], number> = { invalid_policy: 422, hash_mismatch: 409, stale_base: 409, widening_not_confirmed: 428 };

export async function POST(request: Request): Promise<Response> {
  const userId = await sessionOr401(request);
  if (userId instanceof Response) return userId;
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch {
    return jsonError(400, "invalid body", "bad_request");
  }
  // Re-derive the complete policy server side; the client's copy only has to hash the same.
  const rest = { ...(body.candidate as Record<string, unknown>) };
  delete rest.base_currency; // from the account, never the client
  delete rest.version; // assigned at activation
  const perPayee = (rest.global as { per_payee_daily_cap?: Record<string, number> } | undefined)?.per_payee_daily_cap;
  const draftInput = perPayee
    ? { ...rest, global: { ...(rest.global as object), per_payee_daily_cap: Object.entries(perPayee).map(([biller_id, cap]) => ({ biller_id, cap })) } }
    : rest;
  const draft = PolicyDraft.safeParse(draftInput);
  if (!draft.success) return jsonError(422, "candidate does not match the mandate schema", "invalid_policy");
  try {
    const { policy } = withDefaults(draft.data, await baseCurrencyOf(userId));
    const r = await activateMandate(userId, { candidate: policy, policyHash: body.policyHash, baseVersion: body.baseVersion, createdVia: body.createdVia, confirmWidening: body.confirmWidening });
    return Response.json(r);
  } catch (e) {
    if (e instanceof MandateActivateError) return jsonError(STATUS[e.code], e.code.replaceAll("_", " "), e.code);
    return internal("mandate activate failed", e);
  }
}
