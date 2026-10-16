// GET /api/summary?period=YYYY-MM (FR12a.1). Defaults to the current month.
// No `runtime` export: Node is the default and the only runtime under cacheComponents.

import fixture from "@/fixtures/api/summary.json";
import type { SummaryResponse } from "@/src/server/api-types";
import { jsonError, readRoute } from "@/src/server/db/read/http";
import { buildSummary } from "@/src/server/db/read/views";

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function GET(req: Request): Promise<Response> {
  return readRoute<SummaryResponse>(
    req,
    () => fixture as SummaryResponse,
    async (d) => {
      const period = new URL(req.url).searchParams.get("period") ?? d.now.slice(0, 7);
      if (!PERIOD.test(period)) return jsonError(400, "period must be YYYY-MM", "bad_period");
      return buildSummary(d, period);
    },
  );
}
