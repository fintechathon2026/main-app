// Owner: R3 (roles.md). Minimal version by R1; extend, don't duplicate.
// HTTP handlers for the registry simulator (architecture §24.7). Routes under app/sim/registry
// are thin wrappers around these.

import { z } from "zod";
import { simAdminOk, simReadOk } from "../auth";
import { ATTESTATION_VARIANTS, OracleKeyMissing, listAttestations, publishAttestation } from "./attestations";
import { findSimMerchant } from "./merchants";
import { signalBundle } from "./signals";

const noStore = { "cache-control": "no-store" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: noStore });

function merchantParam(req: Request): string | null {
  const v = new URL(req.url).searchParams.get("merchant");
  return v && v.trim().length > 0 && v.length <= 64 ? v.trim() : null;
}

/** GET /sim/registry/attestations?merchant= */
export function handleListAttestations(req: Request): Response {
  if (!simReadOk(req)) return json({ error: "unauthorized" }, 401);
  const ref = merchantParam(req);
  if (!ref) return json({ error: "merchant required" }, 400);
  const m = findSimMerchant(ref);
  return json({ merchant: m?.id ?? ref, simulated: true, attestations: m ? listAttestations(m) : [] });
}

const PublishBody = z
  .object({
    merchant: z.string().min(1).max(64),
    kind: z.enum(["court_enforcement", "closure_notice"]),
    variant: z.enum(ATTESTATION_VARIANTS).optional(),
  })
  .strict();

/** POST /sim/registry/publish {merchant, kind, variant?} (admin only). */
export async function handlePublish(req: Request): Promise<Response> {
  if (!simAdminOk(req)) return json({ error: "unauthorized" }, 401);
  let body: z.infer<typeof PublishBody>;
  try {
    body = PublishBody.parse(await req.json());
  } catch {
    return json({ error: "invalid body" }, 400);
  }
  const merchant = findSimMerchant(body.merchant);
  if (!merchant) return json({ error: "unknown merchant" }, 404);
  try {
    const attestation = await publishAttestation({ merchant, kind: body.kind, variant: body.variant });
    return json({ merchant: merchant.id, simulated: true, attestation }, 201);
  } catch (e) {
    if (e instanceof OracleKeyMissing) return json({ error: "oracle key not configured" }, 503);
    throw e;
  }
}

/** GET /sim/registry/signals?merchant= (SignalBundle shape, every item simulated). */
export function handleSignals(req: Request): Response {
  if (!simReadOk(req)) return json({ error: "unauthorized" }, 401);
  const ref = merchantParam(req);
  if (!ref) return json({ error: "merchant required" }, 400);
  return json(signalBundle(ref));
}
