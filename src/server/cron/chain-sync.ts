// Owner: R3 (roles.md).
// Chain sync job (architecture §11.1, job `chain-sync`). With the mock escrow (REINS_ESCROW unset
// or anything but "chain", like the executor, which always uses the mock escrow) there is no chain
// to index, so the run is recorded as a skipped no-op. With REINS_ESCROW=chain the indexer is not
// built yet and the job refuses instead of pretending to have synced.
// TODO(R3-09): index escrow events from public.chain_cursors.last_block into public.chain_txs.

import { getPool } from "../db/pool";
import { recordJobRun } from "../db/read/detect-store";

export class ChainSyncNotImplementedError extends Error {
  readonly code = "chain_sync_not_implemented";
  constructor() {
    super("chain sync is not implemented for REINS_ESCROW=chain");
    this.name = "ChainSyncNotImplementedError";
  }
}

export type ChainSyncStats = { mode: "mock"; skipped: true };

export async function runChainSyncJob(): Promise<ChainSyncStats> {
  if (process.env.REINS_ESCROW === "chain") throw new ChainSyncNotImplementedError();
  return recordJobRun(getPool(), "chain-sync", async (): Promise<ChainSyncStats> => ({ mode: "mock", skipped: true }), (r) => r);
}
