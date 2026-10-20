// Owner: R2 (roles.md).
// GET /api/mandates/active (architecture §13): the signed mandate in force, for the Mandate Card.
// Read only; activation is a separate route. A stored mandate that fails its hash or the strict
// schema is a 500, never a card. REINS_FIXTURES=1 serves fixtures/api/mandates-active.json.
// No `runtime` export: cacheComponents is on, and Node is the default runtime.

import fixture from "@/fixtures/api/mandates-active.json";
import type { MandateActiveResponse } from "@/src/server/api-types";
import { jsonError, readRoute } from "@/src/server/db/read/http";
import { loadActiveMandate } from "@/src/server/db/read/mandate-repo";

export async function GET(req: Request): Promise<Response> {
  return readRoute<MandateActiveResponse>(
    req,
    () => fixture as MandateActiveResponse,
    async (d) => (await loadActiveMandate(d.userId)) ?? jsonError(404, "no active mandate", "no_active_mandate"),
  );
}
