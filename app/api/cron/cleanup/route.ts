// Cleanup job (architecture §11.1, job `cleanup`): closes paused plans whose approvals expired, so
// they stop holding their (user, trigger, subject) key. Protected by CRON_SECRET.
// Users: `REINS_CRON_USER_IDS` (comma-separated UUIDs) until R3 adds a definer function that lists
// users; reins_server cannot list `users` across RLS.

import { connection } from "next/server";
import { isUuid } from "@/src/server/auth/session";
import { verifyCronAuth } from "@/src/server/auth/cron";
import { getPool } from "@/src/server/db/pool";
import { recordJobRun } from "@/src/server/db/read/detect-store";
import { closeExpiredPausedPlans } from "@/src/server/plans/expiry";

async function run(req: Request): Promise<Response> {
  await connection();
  if (!verifyCronAuth(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const users = (process.env.REINS_CRON_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(isUuid);
  try {
    const results = await recordJobRun(
      getPool(),
      "cleanup",
      async () => {
        const out: ({ userId: string; closedPlans: number } | { userId: string; error: string })[] = [];
        for (const userId of users) {
          try {
            out.push({ userId, closedPlans: (await closeExpiredPausedPlans(userId)).length });
          } catch (e) {
            out.push({ userId, error: (e as Error).message });
          }
        }
        return out;
      },
      (r) => ({ users: r.length, failed: r.filter((x) => "error" in x).length }),
    );
    return Response.json({ ok: true, results }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error(JSON.stringify({ msg: "cron/cleanup failed", error: (e as Error).message }));
    return Response.json({ error: "cleanup_failed" }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
