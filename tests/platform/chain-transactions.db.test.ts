// Owner: R3 (roles.md).
// GET /api/audit/transactions against Postgres: the user's own on-chain transactions with Basescan
// links, from what the app sent (chain_txs) and what chain-sync indexed (plans, sessions); mock
// escrow ids are simulated and get no link. Skipped without DATABASE_URL.

import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { actionHash } from "@/src/core/mandate/canonical";
import { getPool, setPool } from "@/src/server/db/pool";
import { DB_ENABLED, adminPool, createTestUser } from "../foundations/helpers";

vi.mock("next/server", () => ({ connection: async () => {} }));

const { GET } = await import("@/app/api/audit/transactions/route");

const get = (user: string | null, query = "") =>
  GET(new Request(`http://localhost/api/audit/transactions${query}`, { headers: user ? { "x-demo-user": user } : {} }));

const hex = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;

describe.skipIf(!DB_ENABLED)("platform: on-chain transaction list", () => {
  let admin: Pool;
  let owner: string;
  let other: string;
  const merchantId = `TEST_TX_GYM_${randomUUID().slice(0, 8).toUpperCase()}`;
  const seed = Math.floor(Math.random() * 1e9);
  const purchaseTx = hex(seed + 1);
  const sessionTx = hex(seed + 2);
  const exitTx = hex(seed + 3);

  beforeEach(() => {
    vi.stubEnv("REINS_DEMO_AUTH", "1");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
  });

  beforeAll(async () => {
    admin = adminPool();
    owner = (await createTestUser(admin, [])).id;
    other = (await createTestUser(admin, [])).id;
    await admin.query(
      "insert into public.prepaid_merchants (id, name, chain_address, escrow_supported, risk_level) values ($1, 'Tx Gym', '0x00000000000000000000000000000000000000aa', true, 'none')",
      [merchantId],
    );
    const chainPlanId = String(9_000_000_000 + (seed % 1_000_000));
    const plan = await admin.query(
      `insert into public.prepaid_plans (user_id, chain_plan_id, merchant_id, unit_price, units_total, units_redeemed, cancel_fee_bps, status, purchase_tx, last_synced_block)
       values ($1, $2, $3, 10000, 3, 1, 1000, 'exited_attested', $4, 1) returning id`,
      [owner, chainPlanId, merchantId, purchaseTx],
    );
    const planId = plan.rows[0].id as string;
    await admin.query("insert into public.prepaid_sessions (plan_id, user_id, session_no, tx_hash, redeemed_at) values ($1, $2, 1, $3, now() - interval '1 day')", [
      planId,
      owner,
      sessionTx,
    ]);
    // The exit the app sent itself, recorded in chain_txs against its action.
    const p = await admin.query("insert into public.plans (user_id, trigger, subject_id, status) values ($1, 'prepaid_risk', $2, 'done') returning id", [owner, planId]);
    const args = { plan_id: planId };
    const a = await admin.query(
      `insert into public.actions (plan_id, user_id, idx, tool, actor, args_json, args_hash, mandate_version, idempotency_key, status)
       values ($1, $2, 0, 'prepaid_exit', 'agent', $3, $4, 3, $5, 'succeeded') returning id`,
      [p.rows[0].id, owner, JSON.stringify(args), actionHash("prepaid_exit", args), `test:${randomUUID()}`],
    );
    await admin.query(
      `insert into public.chain_txs (user_id, action_id, sender, method, raw_tx, tx_hash, nonce, status, confirmed_at)
       values ($1, $2, 'agent', 'exitWithAttestation', '0x00', $3, $4, 'confirmed', now())`,
      [owner, a.rows[0].id, exitTx, seed],
    );
  });

  afterAll(async () => {
    await admin.query("delete from public.prepaid_plans where merchant_id = $1", [merchantId]);
    await admin.query("delete from public.prepaid_merchants where id = $1", [merchantId]);
    await admin.end();
    await getPool().end();
    setPool(null);
  });

  it("refuses without a session", async () => {
    expect((await get(null)).status).toBe(401);
  });

  it("lists purchase, session and the app's own exit with Basescan links, newest first", async () => {
    const res = await get(owner);
    expect(res.status).toBe(200);
    const { transactions } = (await res.json()) as { transactions: Record<string, unknown>[] };
    const byHash = new Map(transactions.map((t) => [t.hash, t]));
    expect(byHash.get(exitTx)).toMatchObject({ kind: "attested_exit", sender: "agent", status: "confirmed", source: "sent_by_app", simulated: false });
    expect(byHash.get(exitTx)?.explorerUrl).toBe(`https://sepolia.basescan.org/tx/${exitTx}`);
    expect(byHash.get(sessionTx)).toMatchObject({ kind: "redeem", sessionNo: 1, source: "indexed" });
    expect(byHash.get(purchaseTx)).toMatchObject({ kind: "purchase", source: "indexed" });
    expect(transactions[0].hash).toBe(exitTx);
  });

  it("never shows another user's transactions", async () => {
    const { transactions } = (await (await get(other)).json()) as { transactions: { hash: string }[] };
    expect(transactions.map((t) => t.hash)).not.toContain(exitTx);
    expect(transactions.map((t) => t.hash)).not.toContain(purchaseTx);
  });

  it("exports CSV with the explorer link column", async () => {
    const res = await get(owner, "?format=csv");
    expect(res.headers.get("content-type")).toContain("text/csv");
    const text = await res.text();
    expect(text.split("\r\n")[0]).toBe("hash,explorerUrl,simulated,kind,chainPlanId,sessionNo,sender,status,at,source");
    expect(text).toContain(`https://sepolia.basescan.org/tx/${exitTx}`);
  });

  it("rejects an unknown format", async () => {
    expect((await get(owner, "?format=xml")).status).toBe(400);
  });
});
