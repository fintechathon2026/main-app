// Owner: R3 (roles.md). Minimal version by R1; extend, don't duplicate.
// POST /sim/registry/publish {merchant, kind, variant?} : admin-only demo button that signs a new
// attestation with the oracle key (architecture §24.7). Bearer SIM_API_KEY.
// No `runtime` export: cacheComponents is on, and Node is the default runtime.

import { handlePublish } from "@/src/sim/registry/http";

export async function POST(req: Request): Promise<Response> {
  return handlePublish(req);
}
