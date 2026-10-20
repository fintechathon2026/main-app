// Daily detection (architecture §11.1, job `detect`): recurring detection, subscription upserts and
// recommendation scores per user. Protected by CRON_SECRET.
// Users: `REINS_CRON_USER_IDS` (comma-separated UUIDs) when set, else public.cron_user_ids()
// (users with an active mandate). The job lives in src/server/cron/jobs.ts (shared with run-now).
// TODO(integration): trigger agent proposals (trigger "detector") after the job.

import { connection } from "next/server";
import { verifyCronAuth } from "@/src/server/auth/cron";
import { cronUserIds, runDetectJob } from "@/src/server/cron/jobs";

async function run(req: Request): Promise<Response> {
  await connection();
  if (!verifyCronAuth(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    const results = await runDetectJob(await cronUserIds());
    return Response.json({ ok: true, results });
  } catch (e) {
    return Response.json({ error: "detect_failed", detail: (e as Error).message }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
