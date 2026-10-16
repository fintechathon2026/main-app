// GET /api/recommendations (FR5.10): stored rows from cron/detect with live annual savings.

import fixture from "@/fixtures/api/recommendations.json";
import type { RecommendationsResponse } from "@/src/server/api-types";
import { readRoute } from "@/src/server/db/read/http";
import { buildRecommendations } from "@/src/server/db/read/views";

export async function GET(req: Request): Promise<Response> {
  return readRoute<RecommendationsResponse>(req, () => fixture as RecommendationsResponse, (d) => buildRecommendations(d));
}
