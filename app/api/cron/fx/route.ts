// Daily FX fetch (architecture §11.1, job `fx`). Protected by CRON_SECRET; records a job_runs row.
// The job itself lives in src/server/cron/jobs.ts (shared with POST /api/admin/run-now).
// No `runtime` export: Node is the default and the only runtime under cacheComponents.

import { connection } from "next/server";
import { verifyCronAuth } from "@/src/server/auth/cron";
import { runFxJob } from "@/src/server/cron/jobs";

async function run(req: Request): Promise<Response> {
  await connection();
  if (!verifyCronAuth(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    const rows = await runFxJob();
    return Response.json({ ok: true, stored: rows.length, rates: rows });
  } catch (e) {
    return Response.json({ error: "fx_fetch_failed", detail: (e as Error).message }, { status: 502 });
  }
}

export const GET = run;
export const POST = run;
