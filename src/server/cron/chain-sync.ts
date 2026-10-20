// Owner: R3 (roles.md).
// Chain sync job (architecture §11.1, §24.6, job `chain-sync`). With the mock escrow (REINS_ESCROW
// unset or anything but "chain", like the executor) there is no chain to index, so the run is
// recorded as a skipped no-op. With REINS_ESCROW=chain it indexes PrepaidEscrow logs into
// prepaid_plans / prepaid_sessions from public.chain_cursors (src/server/chain/indexer.ts). An
// incomplete chain env refuses instead of pretending to have synced.

import { chainConfigFromEnv, publicClientFor } from "../chain/client";
import { runChainSync, type ChainSyncStats as IndexerStats } from "../chain/indexer";
import { getPool } from "../db/pool";
import { recordJobRun } from "../db/read/detect-store";
import { cronUserIds } from "./users";

export class ChainSyncNotImplementedError extends Error {
  readonly code = "chain_not_configured";
  constructor() {
    super("REINS_ESCROW=chain needs ESCROW_ADDRESS and BASE_SEPOLIA_RPC_URL");
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
    async (): Promise<ChainSyncStats> => ({
      mode: "chain",
      ...(await runChainSync(getPool(), {
        client: publicClientFor(chain),
        escrow: chain.escrowAddress,
        userIds,
        startBlock: BigInt(process.env.CHAIN_START_BLOCK ?? "0"),
        confirmations: process.env.CHAIN_CONFIRMATIONS ? Number(process.env.CHAIN_CONFIRMATIONS) : undefined,
        chunk: process.env.CHAIN_LOG_CHUNK ? Number(process.env.CHAIN_LOG_CHUNK) : undefined,
      })),
    }),
    (r) => r,
  );
}
