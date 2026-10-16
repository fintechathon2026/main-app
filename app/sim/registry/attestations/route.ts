// Owner: R3 (roles.md). Minimal version by R1; extend, don't duplicate.
// GET /sim/registry/attestations?merchant= : signed attestations (architecture §24.7).
// No `runtime` export: cacheComponents is on, and Node is the default runtime.

import { handleListAttestations } from "@/src/sim/registry/http";

export async function GET(req: Request): Promise<Response> {
  return handleListAttestations(req);
}
