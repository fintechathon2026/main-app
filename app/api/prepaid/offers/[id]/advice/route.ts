// GET /api/prepaid/offers/:id/advice[?expectedSessions=n] (PRD §15.11). Every number comes from
// advisePrepaid; `explanation` is left for the Explainer.

import fixture from "@/fixtures/api/prepaid-offer-advice.json";
import type { PrepaidAdviceResponse } from "@/src/server/api-types";
import { jsonError, readRoute } from "@/src/server/db/read/http";
import { buildAdvice } from "@/src/server/db/read/views";

export async function GET(req: Request, ctx: RouteContext<"/api/prepaid/offers/[id]/advice">): Promise<Response> {
  const { id } = await ctx.params;
  const raw = new URL(req.url).searchParams.get("expectedSessions");
  const expected = raw === null ? undefined : Number(raw);
  const badExpected = expected !== undefined && !(Number.isInteger(expected) && expected > 0 && expected <= 1000);
  return readRoute<PrepaidAdviceResponse>(
    req,
    () => (id === fixture.offerId ? (fixture as PrepaidAdviceResponse) : jsonError(404, "offer not found", "not_found")),
    async (d) => {
      if (badExpected) return jsonError(400, "expectedSessions must be a positive integer", "bad_expected_sessions");
      const r = await buildAdvice(d, id, { expectedSessions: expected });
      if (!r) return jsonError(404, "offer not found", "not_found");
      return r.advice;
    },
  );
}
