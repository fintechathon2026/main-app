// Owner: R2 (roles.md). GET /api/mandates/history: versions with diffs (architecture §13).

import { connection } from "next/server";
import { getMandateHistory } from "@/src/server/mandate/store";
import { internal, sessionOr401 } from "../_lib";

export async function GET(request: Request): Promise<Response> {
  await connection();
  const userId = await sessionOr401(request);
  if (userId instanceof Response) return userId;
  try {
    return Response.json(await getMandateHistory(userId), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return internal("mandate history failed", e);
  }
}
