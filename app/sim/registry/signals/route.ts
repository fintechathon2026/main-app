// Owner: R3 (roles.md). Minimal version by R1; extend, don't duplicate.
// GET /sim/registry/signals?merchant= : simulated complaint counts and news snippets, including
// the T25 attack texts and a fake spike (architecture §24.7). Every item is marked simulated.
// No `runtime` export: cacheComponents is on, and Node is the default runtime.

import { handleSignals } from "@/src/sim/registry/http";

export async function GET(req: Request): Promise<Response> {
  return handleSignals(req);
}
