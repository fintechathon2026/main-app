// Owner: R2 (roles.md).
// GET /api/mandates/history (architecture §13): every signed version, newest first, each with one
// sentence about what changed. Read only. `direction` (less/more permission against the previous
// version) comes from compareMandates (see buildHistory). REINS_FIXTURES=1 serves
// fixtures/api/mandates-history.json.

import fixture from "@/fixtures/api/mandates-history.json";
import type { MandateHistoryResponse } from "@/src/server/api-types";
import { readRoute } from "@/src/server/db/read/http";
import { loadMandateHistory } from "@/src/server/db/read/mandate-repo";

export async function GET(req: Request): Promise<Response> {
  return readRoute<MandateHistoryResponse>(
    req,
    () => fixture as MandateHistoryResponse,
    (d) => loadMandateHistory(d.userId),
  );
}
