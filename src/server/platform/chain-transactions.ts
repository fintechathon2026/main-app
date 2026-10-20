// Owner: R3 (roles.md).
// The user's on-chain transaction list with Basescan links (architecture §17, task R3-14; the
// execution-evidence item of the submission). Two sources, both read under RLS for the signed-in
// user: transactions the app sent itself (chain_txs: agent exits, relayed purchases, check-ins,
// voluntary exits) and the plan purchases and sessions chain-sync indexed from the escrow's logs.
// Mock escrow ids (`mock:…`) are not on any explorer and are listed as simulated.

import { toCsv } from "@/src/core/export/serialize";
import { withUserTx } from "../db/pool";
import { chainTxRef } from "../db/read/db";

export type ChainTxRow = {
  hash: string;
  explorerUrl: string | null;
  simulated: boolean;
  /** What happened, in the contract's own terms. */
  kind: "purchase" | "redeem" | "attested_exit" | "voluntary_exit" | "other";
  chainPlanId: string | null;
  sessionNo: number | null;
  sender: "relayer" | "agent" | null;
  status: "signed" | "broadcast" | "confirmed" | "reverted" | "indexed";
  at: string | null;
  source: "sent_by_app" | "indexed";
};

const KIND: Record<string, ChainTxRow["kind"]> = {
  purchaseWithPermit: "purchase",
  redeem: "redeem",
  exitWithAttestation: "attested_exit",
  exitVoluntaryBySig: "voluntary_exit",
};

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v ? String(v) : null);

export function listChainTransactions(userId: string): Promise<ChainTxRow[]> {
  return withUserTx(userId, async (tx) => {
    const sent = await tx.query(
      `select c.tx_hash, c.method, c.sender, c.status, coalesce(c.confirmed_at, c.submitted_at) as at, p.chain_plan_id::text as chain_plan_id,
              (a.args_json->>'session_no')::int as session_no
         from public.chain_txs c
         join public.actions a on a.id = c.action_id
         left join public.prepaid_plans p on p.id::text = a.args_json->>'plan_id'
        where c.user_id = $1`,
      [userId],
    );
    const plans = await tx.query(
      "select chain_plan_id::text as chain_plan_id, purchase_tx from public.prepaid_plans where user_id = $1",
      [userId],
    );
    const sessions = await tx.query(
      `select p.chain_plan_id::text as chain_plan_id, s.session_no, s.tx_hash, s.redeemed_at
         from public.prepaid_sessions s join public.prepaid_plans p on p.id = s.plan_id
        where s.user_id = $1`,
      [userId],
    );

    const out = new Map<string, ChainTxRow>();
    const put = (r: Omit<ChainTxRow, "explorerUrl" | "simulated">) => {
      if (!r.hash || out.has(r.hash.toLowerCase())) return; // the app's own record wins
      const ref = chainTxRef(r.hash);
      out.set(r.hash.toLowerCase(), { ...r, explorerUrl: ref.simulated ? null : ref.explorerUrl, simulated: ref.simulated });
    };
    for (const r of sent.rows) {
      put({
        hash: r.tx_hash,
        kind: KIND[r.method] ?? "other",
        chainPlanId: r.chain_plan_id ?? null,
        sessionNo: r.method === "redeem" ? (r.session_no ?? null) : null,
        sender: r.sender,
        status: r.status,
        at: iso(r.at),
        source: "sent_by_app",
      });
    }
    for (const r of plans.rows) {
      if (!r.purchase_tx || r.purchase_tx === "unknown") continue;
      put({ hash: r.purchase_tx, kind: "purchase", chainPlanId: r.chain_plan_id, sessionNo: null, sender: null, status: "indexed", at: null, source: "indexed" });
    }
    for (const r of sessions.rows) {
      put({
        hash: r.tx_hash,
        kind: "redeem",
        chainPlanId: r.chain_plan_id,
        sessionNo: Number(r.session_no),
        sender: null,
        status: "indexed",
        at: iso(r.redeemed_at),
        source: "indexed",
      });
    }
    // Newest first; rows without a time (indexed purchases) go last, by plan id.
    return [...out.values()].sort((a, b) => (b.at ?? "").localeCompare(a.at ?? "") || (a.chainPlanId ?? "").localeCompare(b.chainPlanId ?? ""));
  });
}

export const CHAIN_TX_COLUMNS = ["hash", "explorerUrl", "simulated", "kind", "chainPlanId", "sessionNo", "sender", "status", "at", "source"] as const;

export function chainTransactionsCsv(rows: ChainTxRow[]): string {
  return toCsv([...CHAIN_TX_COLUMNS], rows);
}
