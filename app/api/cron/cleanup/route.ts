// Cleanup job (architecture §11.1, job `cleanup`): closes paused plans whose approvals expired, so
// they stop holding their (user, trigger, subject) key. Protected by CRON_SECRET.
// Users: `REINS_CRON_USER_IDS` (comma-separated UUIDs) when set, else public.cron_user_ids()
// (users with an active mandate). The job lives in src/server/cron/jobs.ts (shared with run-now).

import { connection } from "next/server";
import { verifyCronAuth } from "@/src/server/auth/cron";
import { cronUserIds, runCleanupJob } from "@/src/server/cron/jobs";

async function run(req: Request): Promise<Response> {
  await connection();
  if (!verifyCronAuth(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    const results = await runCleanupJob(await cronUserIds());
    return Response.json({ ok: true, results }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error(JSON.stringify({ msg: "cron/cleanup failed", error: (e as Error).message }));
    return Response.json({ error: "cleanup_failed" }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
