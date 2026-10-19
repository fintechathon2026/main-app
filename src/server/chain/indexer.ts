// Owner: R3 (roles.md).
// cron/chain-sync indexer (PRD_PrepaidEscrow_Contract §7.6, architecture §24.6): Purchased,
// Redeemed and Exited logs -> prepaid_plans and prepaid_sessions for the configured users.
// Plan state is re-read from the contract for every touched plan, so the index converges on the
// chain even if logs arrive out of order or a run is repeated. Read-only on chain: no keys.

import type { Address, Hex, PublicClient } from "viem";
import type { Pool } from "pg";
import { withUserTx } from "@/src/server/db/pool";
import { PREPAID_ESCROW_ABI } from "./abi";
import { readChainPlan, type ChainPlan } from "./client";

export type ChainSyncConfig = {
  client: PublicClient;
  escrow: Address;
  /** Users whose wallets are indexed (REINS_CRON_USER_IDS until a definer lookup exists). */
  userIds: string[];
  /** First block to scan when there is no cursor yet (the deploy block). */
  startBlock: bigint;
  confirmations?: number;
  chunk?: number;
};

export type ChainSyncStats = {
  fromBlock: string | null;
  toBlock: string | null;
  logs: number;
  plansTouched: number;
  plansUpserted: number;
  sessionsInserted: number;
  unknownMerchant: number;
  errors: { userId: string; planId?: string; error: string }[];
};

type PlanLogs = {
  purchaseTx: Hex | null;
  sessions: { sessionNo: number; txHash: Hex; blockNumber: bigint }[];
};

const cursorKey = (escrow: Address) => `PrepaidEscrow:${escrow.toLowerCase()}`;

async function readCursor(pool: Pool, escrow: Address): Promise<bigint | null> {
  const r = await pool.query("select last_block from public.chain_cursors where contract = $1", [cursorKey(escrow)]);
  return r.rowCount ? BigInt(r.rows[0].last_block) : null;
}

async function writeCursor(pool: Pool, escrow: Address, block: bigint): Promise<void> {
  await pool.query(
    `insert into public.chain_cursors (contract, last_block) values ($1, $2)
     on conflict (contract) do update set last_block = greatest(public.chain_cursors.last_block, excluded.last_block)`,
    [cursorKey(escrow), block.toString()],
  );
}

/** Purchase tx of a plan bought before the scanned range (first sync after a cursor reset). */
async function findPurchaseTx(cfg: ChainSyncConfig, planId: bigint): Promise<Hex | null> {
  const logs = await cfg.client.getContractEvents({
    address: cfg.escrow,
    abi: PREPAID_ESCROW_ABI,
    eventName: "Purchased",
    args: { planId },
    fromBlock: cfg.startBlock,
  });
  return logs[0]?.transactionHash ?? null;
}

export async function runChainSync(pool: Pool, cfg: ChainSyncConfig): Promise<ChainSyncStats> {
  const stats: ChainSyncStats = {
    fromBlock: null,
    toBlock: null,
    logs: 0,
    plansTouched: 0,
    plansUpserted: 0,
    sessionsInserted: 0,
    unknownMerchant: 0,
    errors: [],
  };
  const latest = await cfg.client.getBlockNumber();
  const to = latest - BigInt(cfg.confirmations ?? 2);
  const cursor = await readCursor(pool, cfg.escrow);
  const from = cursor === null ? cfg.startBlock : cursor + BigInt(1);
  if (to < from) return stats;
  stats.fromBlock = from.toString();
  stats.toBlock = to.toString();

  // 1. Logs, in chunks.
  const touched = new Map<bigint, PlanLogs>();
  const entry = (id: bigint) => {
    let e = touched.get(id);
    if (!e) touched.set(id, (e = { purchaseTx: null, sessions: [] }));
    return e;
  };
  const chunk = BigInt(cfg.chunk ?? 2000);
  for (let start = from; start <= to; start += chunk) {
    const end = start + chunk - BigInt(1) < to ? start + chunk - BigInt(1) : to;
    const logs = await cfg.client.getContractEvents({ address: cfg.escrow, abi: PREPAID_ESCROW_ABI, fromBlock: start, toBlock: end });
    stats.logs += logs.length;
    for (const log of logs) {
      if (log.eventName === "Purchased") entry(log.args.planId!).purchaseTx = log.transactionHash;
      else if (log.eventName === "Redeemed")
        entry(log.args.planId!).sessions.push({ sessionNo: Number(log.args.sessionNo), txHash: log.transactionHash, blockNumber: log.blockNumber });
      else if (log.eventName === "Exited") entry(log.args.planId!);
    }
  }
  stats.plansTouched = touched.size;

  // 2. Current state of every touched plan, from the contract.
  const plans: ChainPlan[] = [];
  for (const id of touched.keys()) {
    const p = await readChainPlan(cfg.client, cfg.escrow, id);
    if (p) plans.push(p);
  }
  const blockTimes = new Map<bigint, Date>();
  const timeOf = async (n: bigint) => {
    if (!blockTimes.has(n)) blockTimes.set(n, new Date(Number((await cfg.client.getBlock({ blockNumber: n })).timestamp) * 1000));
    return blockTimes.get(n)!;
  };

  // 3. Per user: only plans owned by that user's wallet.
  for (const userId of cfg.userIds) {
    try {
      const ctx = await withUserTx(userId, async (tx) => {
        const w = await tx.query("select address from public.wallets where user_id = $1 and kind = 'consumer_browser'", [userId]);
        const m = await tx.query("select id, chain_address from public.prepaid_merchants");
        return {
          wallet: (w.rows[0]?.address as string | undefined)?.toLowerCase() ?? null,
          merchants: new Map(m.rows.map((r) => [String(r.chain_address).toLowerCase(), String(r.id)])),
        };
      });
      if (!ctx.wallet) continue;
      for (const p of plans.filter((x) => x.consumer.toLowerCase() === ctx.wallet)) {
        const merchantId = ctx.merchants.get(p.merchant.toLowerCase());
        if (!merchantId) {
          stats.unknownMerchant++; // never invent a merchant
          continue;
        }
        const logs = touched.get(p.planId)!;
        const purchaseTx = logs.purchaseTx ?? (await findPurchaseTx(cfg, p.planId));
        const sessions = await Promise.all(logs.sessions.map(async (s) => ({ ...s, at: await timeOf(s.blockNumber) })));
        try {
          const inserted = await withUserTx(userId, async (tx) => {
            const r = await tx.query(
              `insert into public.prepaid_plans (user_id, chain_plan_id, merchant_id, unit_price, units_total, units_redeemed,
                 cancel_fee_bps, agent_address, status, purchase_tx, origin, last_synced_block)
               values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'chain', $11)
               on conflict (chain_plan_id) do update
                 set units_redeemed = excluded.units_redeemed, status = excluded.status, last_synced_block = excluded.last_synced_block
               returning id`,
              [
                userId,
                p.planId.toString(),
                merchantId,
                p.unitPrice.toString(),
                p.units,
                p.redeemed,
                p.cancelFeeBps,
                p.agent,
                p.status,
                purchaseTx ?? "unknown",
                to.toString(),
              ],
            );
            const planRowId = r.rows[0].id as string;
            let n = 0;
            for (const s of sessions) {
              const ins = await tx.query(
                `insert into public.prepaid_sessions (plan_id, user_id, session_no, tx_hash, redeemed_at)
                 values ($1, $2, $3, $4, $5) on conflict (plan_id, session_no) do nothing`,
                [planRowId, userId, s.sessionNo, s.txHash, s.at.toISOString()],
              );
              n += ins.rowCount ?? 0;
            }
            return n;
          });
          stats.plansUpserted++;
          stats.sessionsInserted += inserted;
        } catch (e) {
          stats.errors.push({ userId, planId: p.planId.toString(), error: (e as Error).message });
        }
      }
    } catch (e) {
      stats.errors.push({ userId, error: (e as Error).message });
    }
  }

  // 4. Advance only after every user ran, and only when nothing failed (the next run retries).
  if (stats.errors.length === 0) await writeCursor(pool, cfg.escrow, to);
  return stats;
}
