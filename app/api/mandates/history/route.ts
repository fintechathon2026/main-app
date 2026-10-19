// Owner: R2 (roles.md). GET /api/mandates/history: versions with diffs (architecture §13).

import { connection } from "next/server";
import { fixturesEnabled } from "@/src/server/db/read/http";
import { fixtureHistory } from "@/src/server/fixture-state";
import { getMandateHistory } from "@/src/server/mandate/store";
import { internal, sessionOr401 } from "../_lib";

export async function GET(request: Request): Promise<Response> {
  await connection();
  if (fixturesEnabled()) return Response.json(fixtureHistory());
  const userId = await sessionOr401(request);
  if (userId instanceof Response) return userId;
  try {
    return Response.json(await getMandateHistory(userId), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return internal("mandate history failed", e);
  }
}
