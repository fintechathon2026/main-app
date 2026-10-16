// Shared plumbing for R1's read routes: request-time rendering, session → userId, fixture mode.
// REINS_FIXTURES=1 serves fixtures/api/*.json (synthetic Lin data) with no database or session,
// so the UI can be built before the backend is wired (roles.md §1.1).

import { connection } from "next/server";
import type { ApiError } from "../../api-types";
import { getSessionUserId } from "../../auth/session";
import { getReadRepos } from "./repos";
import type { ViewDeps } from "./views";

export const fixturesEnabled = () => process.env.REINS_FIXTURES === "1";

export const jsonError = (status: number, error: string, code?: string) =>
  Response.json({ error, ...(code ? { code } : {}) } satisfies ApiError, { status });

/**
 * Runs `fn` for the signed-in user. With fixtures on, returns `fixture()` instead. `fn` may
 * return a Response (for 4xx) or a body to serialize.
 */
export async function readRoute<T>(
  req: Request,
  fixture: () => T | Response,
  fn: (d: ViewDeps) => Promise<T | Response>,
): Promise<Response> {
  await connection(); // always render at request time (cacheComponents)
  if (fixturesEnabled()) {
    const f = fixture();
    return f instanceof Response ? f : Response.json(f);
  }
  const userId = await getSessionUserId(req);
  if (!userId) return jsonError(401, "unauthorized");
  try {
    const out = await fn({ repos: getReadRepos(), userId, now: new Date().toISOString() });
    return out instanceof Response ? out : Response.json(out);
  } catch (e) {
    console.error(`[read-route] ${new URL(req.url).pathname}:`, (e as Error).message);
    return jsonError(500, "internal_error");
  }
}
