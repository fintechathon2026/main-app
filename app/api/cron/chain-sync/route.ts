// GET|POST /api/cron/chain-sync (PRD_PrepaidEscrow_Contract §7.6, architecture §24.6): indexes
// PrepaidEscrow logs into prepaid_plans / prepaid_sessions. Every 5 minutes, or "Run now".
// Bearer CRON_SECRET. Users: `REINS_CRON_USER_IDS` until R3 adds a security-definer lookup.
// No `runtime` export: cacheComponents is on, and Node is the default.

import { connection } from "next/server";
import { verifyCronAuth } from "@/src/server/auth/cron";
import { isUuid } from "@/src/server/auth/session";
import { chainConfigFromEnv, publicClientFor } from "@/src/server/chain/client";
import { runChainSync } from "@/src/server/chain/indexer";
import { getPool } from "@/src/server/db/pool";
import { recordJobRun } from "@/src/server/db/read/detect-store";

async function run(req: Request): Promise<Response> {
  await connection();
  if (!verifyCronAuth(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const chain = chainConfigFromEnv();
  if (!chain || process.env.REINS_ESCROW !== "chain") {
    return Response.json({ ok: true, skipped: "chain escrow not configured" }, { headers: { "cache-control": "no-store" } });
  }
  const userIds = (process.env.REINS_CRON_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(isUuid);
  try {
    const stats = await recordJobRun(
      getPool(),
      "chain-sync",
      () =>
        runChainSync(getPool(), {
          client: publicClientFor(chain),
          escrow: chain.escrowAddress,
          userIds,
          startBlock: BigInt(process.env.CHAIN_START_BLOCK ?? "0"),
          confirmations: process.env.CHAIN_CONFIRMATIONS ? Number(process.env.CHAIN_CONFIRMATIONS) : undefined,
          chunk: process.env.CHAIN_LOG_CHUNK ? Number(process.env.CHAIN_LOG_CHUNK) : undefined,
        }),
      (s) => s,
    );
    return Response.json({ ok: stats.errors.length === 0, stats }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error(JSON.stringify({ msg: "cron/chain-sync failed", error: e instanceof Error ? e.message : String(e) }));
    return Response.json({ error: "chain_sync_failed" }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
