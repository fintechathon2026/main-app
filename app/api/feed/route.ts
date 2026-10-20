// Owner: R2 (roles.md).
// GET /api/feed (architecture §13, §15.2): what Reins did or tried for the signed-in user, newest
// first, from the user's decided `actions`. Sentences are templates over stored ids and registry
// names, never model text. REINS_FIXTURES=1 serves fixtures/api/feed.json.
// No `runtime` export: cacheComponents is on, and Node is the default runtime.

import fixture from "@/fixtures/api/feed.json";
import type { FeedResponse } from "@/src/server/api-types";
import { readRoute } from "@/src/server/db/read/http";
import { loadFeed } from "@/src/server/db/read/feed-repo";

export async function GET(req: Request): Promise<Response> {
  return readRoute<FeedResponse>(
    req,
    () => fixture as FeedResponse,
    (d) => loadFeed(d.userId),
  );
}
