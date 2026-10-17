// GET /api/prepaid/offers: unexpired merchant-signed offers (simulated in v1) with merchant risk.

import fixture from "@/fixtures/api/prepaid-offers.json";
import type { PrepaidOffersResponse } from "@/src/server/api-types";
import { readRoute } from "@/src/server/db/read/http";
import { buildPrepaidOffers } from "@/src/server/db/read/views";

export async function GET(req: Request): Promise<Response> {
  return readRoute<PrepaidOffersResponse>(req, () => fixture as PrepaidOffersResponse, (d) => buildPrepaidOffers(d));
}
