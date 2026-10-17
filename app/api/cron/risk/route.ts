// GET|POST /api/cron/risk (architecture §11.1): Vercel Cron daily 09:00 WIB, or "Run now".
// Bearer CRON_SECRET, constant-time compare. Attestations may start prepaid_risk plans; soft
// signals only warn. No `runtime` export: cacheComponents is on, and Node is the default.

import { verifyCronAuth } from "@/src/server/auth/cron";
import { runRiskJobRecorded } from "@/src/server/risk";

async function handle(req: Request): Promise<Response> {
  if (!verifyCronAuth(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    const stats = await runRiskJobRecorded();
    return Response.json({ ok: stats.errors.length === 0, stats }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error(JSON.stringify({ msg: "cron/risk failed", error: e instanceof Error ? e.message : String(e) }));
    return Response.json({ error: "risk job failed" }, { status: 500 });
  }
}

export async function GET(req: Request): Promise<Response> {
  return handle(req);
}

export async function POST(req: Request): Promise<Response> {
  return handle(req);
}
