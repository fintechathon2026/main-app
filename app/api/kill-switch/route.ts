// Owner: R3 (roles.md). GET/POST /api/kill-switch {enabled} (architecture §13, §14.5).

import { connection } from "next/server";
import { z } from "zod";
import { getSessionUserId } from "@/src/server/auth/session";
import { fixturesEnabled, jsonError } from "@/src/server/db/read/http";
import { getKillSwitch, setKillSwitch } from "@/src/server/settings/kill-switch";

const Body = z.object({ enabled: z.boolean() }).strict();

export async function GET(request: Request): Promise<Response> {
  await connection();
  if (fixturesEnabled()) return Response.json({ enabled: false, changedAt: "2026-10-16T00:00:00.000Z" });
  const userId = await getSessionUserId(request);
  if (!userId) return jsonError(401, "unauthorized");
  try {
    return Response.json(await getKillSwitch(userId), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error(JSON.stringify({ msg: "kill switch read failed", error: e instanceof Error ? e.message : String(e) }));
    return jsonError(500, "internal");
  }
}

export async function POST(request: Request): Promise<Response> {
  const userId = await getSessionUserId(request);
  if (!userId) return jsonError(401, "unauthorized");
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch {
    return jsonError(400, "invalid body", "bad_request");
  }
  try {
    return Response.json(await setKillSwitch(userId, body.enabled));
  } catch (e) {
    console.error(JSON.stringify({ msg: "kill switch write failed", error: e instanceof Error ? e.message : String(e) }));
    return jsonError(500, "internal");
  }
}
