// GET /api/prepaid/plans (FR19.7): indexed escrow plans with sessions, signals and tx links.

import fixture from "@/fixtures/api/prepaid-plans.json";
import type { PrepaidPlansResponse } from "@/src/server/api-types";
import { readRoute } from "@/src/server/db/read/http";
import { buildPrepaidPlans } from "@/src/server/db/read/views";

export async function GET(req: Request): Promise<Response> {
  return readRoute<PrepaidPlansResponse>(req, () => fixture as PrepaidPlansResponse, (d) => buildPrepaidPlans(d));
}
