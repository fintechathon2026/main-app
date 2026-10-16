// GET /api/subscriptions[?status=active|inactive|cancelled|trial] (F5).

import fixture from "@/fixtures/api/subscriptions.json";
import type { SubscriptionsResponse } from "@/src/server/api-types";
import { jsonError, readRoute } from "@/src/server/db/read/http";
import { SUBSCRIPTION_STATUSES } from "@/src/server/db/read/subscriptions";
import { buildSubscriptions } from "@/src/server/db/read/views";

export async function GET(req: Request): Promise<Response> {
  return readRoute<SubscriptionsResponse>(
    req,
    () => fixture as SubscriptionsResponse,
    async (d) => {
      const status = new URL(req.url).searchParams.get("status");
      if (status !== null && !(SUBSCRIPTION_STATUSES as readonly string[]).includes(status)) {
        return jsonError(400, "unknown status", "bad_status");
      }
      return buildSubscriptions(d, status);
    },
  );
}
