// Owner: R3 (roles.md).
// GET|POST /api/cron/chain-sync (architecture §11.1, job `chain-sync`). Protected by CRON_SECRET.
// Mock escrow: a recorded no-op. REINS_ESCROW=chain: 501 until the indexer exists (R3-09).
// The job lives in src/server/cron/chain-sync.ts (shared with POST /api/admin/run-now).

import { connection } from "next/server";
import { verifyCronAuth } from "@/src/server/auth/cron";
import { ChainSyncNotImplementedError, runChainSyncJob } from "@/src/server/cron/jobs";

const NO_STORE = { "cache-control": "no-store" };

async function run(req: Request): Promise<Response> {
  await connection();
  if (!verifyCronAuth(req)) return Response.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  try {
    const stats = await runChainSyncJob();
    return Response.json({ ok: true, ...stats }, { headers: NO_STORE });
  } catch (e) {
    if (e instanceof ChainSyncNotImplementedError) return Response.json({ error: e.code }, { status: 501, headers: NO_STORE });
    console.error(JSON.stringify({ msg: "cron/chain-sync failed", error: (e as Error).message }));
    return Response.json({ error: "chain_sync_failed" }, { status: 500, headers: NO_STORE });
  }
}

export const GET = run;
export const POST = run;
