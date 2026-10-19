// Owner: R3 (roles.md).
// GET|POST /api/kill-switch ("Pause everything", architecture §8). Session-scoped: the user can
// only read and flip their own switch. POST {enabled} answers with the stored state, so the UI
// shows "paused" only after the server confirms (src/ui/shell/pause.tsx).

import { z } from "zod";
import fixture from "@/fixtures/api/kill-switch.json";
import type { KillSwitchResponse } from "@/src/server/api-types";
import { jsonError, readRoute } from "@/src/server/db/read/http";
import { getKillSwitch, setKillSwitch } from "@/src/server/platform/kill-switch";

const Body = z.strictObject({ enabled: z.boolean() });

export async function GET(req: Request): Promise<Response> {
  return readRoute<KillSwitchResponse>(req, () => fixture, (d) => getKillSwitch(d.userId));
}

export async function POST(req: Request): Promise<Response> {
  return readRoute<KillSwitchResponse>(
    req,
    () => fixture,
    async (d) => {
      const body = Body.safeParse(await req.json().catch(() => undefined));
      if (!body.success) return jsonError(400, "body must be {enabled: boolean}", "bad_request");
      return setKillSwitch(d.userId, body.data.enabled);
    },
  );
}
