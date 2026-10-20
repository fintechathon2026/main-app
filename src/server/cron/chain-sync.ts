// Owner: R3 (roles.md).
// Chain sync job (architecture §11.1, job `chain-sync`). Mock escrow (REINS_ESCROW unset or
// anything but "chain"): there is no chain to index, so the run is recorded as a skipped no-op.
// REINS_ESCROW=chain: the PrepaidEscrow indexer (src/server/chain/indexer.ts, PRD_PrepaidEscrow_
// Contract §7.6) indexes Purchased, Redeemed and Exited logs into prepaid_plans and
// prepaid_sessions for the cron users. Without a configured chain (ESCROW_ADDRESS and an RPC URL)
// there is nothing to index and the job refuses instead of pretending to have synced.

import { getPool } from "../db/pool";
import { recordJobRun } from "../db/read/detect-store";
import { chainConfigFromEnv, publicClientFor } from "../chain/client";
import { runChainSync, type IndexerStats } from "../chain/indexer";
import { cronUserIds } from "./users";

export class ChainSyncNotImplementedError extends Error {
  readonly code = "chain_sync_not_implemented";
  constructor() {
    super("chain sync is not available: REINS_ESCROW=chain needs ESCROW_ADDRESS and BASE_SEPOLIA_RPC_URL");
    this.name = "ChainSyncNotImplementedError";
  }
}

export type ChainSyncStats = { mode: "mock"; skipped: true } | ({ mode: "chain" } & IndexerStats);

export async function runChainSyncJob(): Promise<ChainSyncStats> {
  if (process.env.REINS_ESCROW !== "chain") {
    return recordJobRun(getPool(), "chain-sync", async (): Promise<ChainSyncStats> => ({ mode: "mock", skipped: true }), (r) => r);
  }
  const chain = chainConfigFromEnv();
  if (!chain) throw new ChainSyncNotImplementedError();
  const userIds = await cronUserIds();
  return recordJobRun(
    getPool(),
    "chain-sync",
    async (): Promise<ChainSyncStats> => {
      const stats = await runChainSync(getPool(), {
        client: publicClientFor(chain),
        escrow: chain.escrowAddress,
        userIds,
        startBlock: BigInt(process.env.CHAIN_START_BLOCK || "0"),
        confirmations: process.env.CHAIN_CONFIRMATIONS ? Number(process.env.CHAIN_CONFIRMATIONS) : undefined,
        chunk: process.env.CHAIN_LOG_CHUNK ? Number(process.env.CHAIN_LOG_CHUNK) : undefined,
      });
      // A partial run did not advance the cursor; fail the job so it is visible and retried.
      if (stats.errors.length > 0) throw new Error(`chain-sync: ${stats.errors.length} plan(s) failed to index`);
      return { mode: "chain", ...stats };
    },
    (r) => r,
  );
}
