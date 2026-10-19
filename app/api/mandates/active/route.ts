// Owner: R2 (roles.md). GET /api/mandates/active: Mandate Card data (architecture §13).

import { connection } from "next/server";
import { fixturesEnabled } from "@/src/server/db/read/http";
import { fixtureActiveMandate } from "@/src/server/fixture-state";
import { getActiveMandate } from "@/src/server/mandate/store";
import { internal, sessionOr401 } from "../_lib";

export async function GET(request: Request): Promise<Response> {
  await connection();
  if (fixturesEnabled()) return Response.json(fixtureActiveMandate());
  const userId = await sessionOr401(request);
  if (userId instanceof Response) return userId;
  try {
    return Response.json(await getActiveMandate(userId), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return internal("mandate active failed", e);
  }
}
