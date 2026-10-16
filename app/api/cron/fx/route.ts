// Daily FX fetch (architecture §11.1, job `fx`). Protected by CRON_SECRET. Node runtime is the
// default and the only runtime under cacheComponents (a `runtime` export fails the build).
// TODO(cron): record a `job_runs` row once that table exists (R3).

import { connection } from "next/server";
import { verifyCronAuth } from "@/src/server/auth/cron";
import { syncFxRates } from "@/src/server/fx/frankfurter";

async function run(req: Request): Promise<Response> {
  await connection();
  if (!verifyCronAuth(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    const rows = await syncFxRates({ now: new Date().toISOString() });
    return Response.json({ ok: true, stored: rows.length, rates: rows });
  } catch (e) {
    return Response.json({ error: "fx_fetch_failed", detail: (e as Error).message }, { status: 502 });
  }
}

export const GET = run;
export const POST = run;
