// ChainEscrowAdapter on a private anvil and local Supabase (PRD_PrepaidEscrow_Contract §8.5, CG5):
// sends go through simulation, nonce allocation and chain_txs exactly once.
// Skipped without anvil + contracts/out, or without DATABASE_URL.

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anvil } from "viem/chains";
import { getPool, setPool } from "@/src/server/db/pool";
import { createChainEscrow, type ChainEscrowAdapter } from "@/src/server/executor";
import { DB_ENABLED, adminPool, createTestUser } from "../foundations/helpers";
import {
  ADDR,
  CHAIN_ENABLED,
  KEYS,
  balanceOf,
  mint,
  resetSenderState,
  signedPurchase,
  signedRedeem,
  signedVoluntaryExit,
  startChain,
  userAction,
  type Chain,
} from "./anvil";

describe.skipIf(!CHAIN_ENABLED || !DB_ENABLED)("chain: escrow adapter", () => {
  let chain: Chain;
  let admin: Pool;
  let adapter: ChainEscrowAdapter;
  let userId: string;

  beforeAll(async () => {
    chain = await startChain();
    admin = adminPool();
    await resetSenderState(admin, "relayer");
    userId = (await createTestUser(admin, [])).id;
    adapter = createChainEscrow({
      chainId: anvil.id,
      rpcUrls: [chain.rpcUrl],
      escrowAddress: chain.escrow,
      tokenAddress: chain.token,
      relayerKey: KEYS.relayer,
      agentKey: KEYS.agent,
      expectedAgentAddress: ADDR.agent,
      publicClient: chain.client,
    });
    await mint(chain, ADDR.consumer, BigInt(100_000_000));
  }, 30_000);

  afterAll(async () => {
    if (admin) await resetSenderState(admin, "relayer"); // a later local chain restarts nonces at 0
    await chain?.stop();
    await admin?.end();
    await getPool().end();
    setPool(null);
  });

  const opts = (a: { id: string; key: string }) => ({ actionId: a.id, idempotencyKey: a.key, userId });
  const relayerNonce = () => chain.client.getTransactionCount({ address: ADDR.relayer });

  async function purchase(units = 60) {
    const p = await signedPurchase(chain, { units });
    const a = await userAction(admin, userId, "prepaid_purchase", { offer_id: crypto.randomUUID() });
    const res = await adapter.purchase(p, opts(a));
    if (res.status !== "confirmed") throw new Error(`purchase ${res.status}`);
    const ev = res.events as { event: string; args: { planId: string } }[];
    return { planId: BigInt(ev.find((e) => e.event === "Purchased")!.args.planId), res, action: a, total: p.total };
  }

  it("purchases through the relayer and records the transaction", async () => {
    const before = await balanceOf(chain, ADDR.consumer);
    const { planId, res, action, total } = await purchase();
    expect(planId).toBeGreaterThan(BigInt(0));
    expect(await balanceOf(chain, ADDR.consumer)).toBe(before - total);
    const plan = await adapter.readPlan(planId.toString());
    expect(plan).toMatchObject({ owner: ADDR.consumer, merchant: ADDR.merchant, agent: ADDR.agent, status: "active", unitsRedeemed: 0, unitsTotal: 60 });

    const row = await admin.query("select sender, method, status, tx_hash, nonce from public.chain_txs where action_id = $1", [action.id]);
    expect(row.rows[0]).toMatchObject({ sender: "relayer", method: "purchaseWithPermit", status: "confirmed" });
    expect(row.rows[0].tx_hash).toBe(res.status === "confirmed" ? res.txHash : null);
  });

  it("redeems one session with both signatures", async () => {
    const { planId } = await purchase();
    const merchantBefore = await balanceOf(chain, ADDR.merchant);
    const a = await userAction(admin, userId, "prepaid_redeem", { plan_id: crypto.randomUUID(), session_no: 1 });
    const res = await adapter.redeem(await signedRedeem(chain, planId, 1), opts(a));
    expect(res.status).toBe("confirmed");
    expect(await balanceOf(chain, ADDR.merchant)).toBe(merchantBefore + BigInt(10_000));
    expect((await adapter.readPlan(planId.toString()))?.unitsRedeemed).toBe(1);
  });

  it("a revert caught in simulation sends nothing and records nothing", async () => {
    const { planId } = await purchase();
    const nonce = await relayerNonce();
    const a = await userAction(admin, userId, "prepaid_redeem", { plan_id: crypto.randomUUID(), session_no: 2 });
    // Session 2 before session 1; and a merchant-only check-in (T22).
    expect(await adapter.redeem(await signedRedeem(chain, planId, 2), opts(a))).toEqual({ status: "reverted", txHash: null, reason: "WrongSession" });
    const forged = await signedRedeem(chain, planId, 1, { consumer: KEYS.merchant });
    expect(await adapter.redeem(forged, opts(a))).toEqual({ status: "reverted", txHash: null, reason: "BadConsumerSig" });
    expect(await relayerNonce()).toBe(nonce);
    const rows = await admin.query("select 1 from public.chain_txs where action_id = $1", [a.id]);
    expect(rows.rowCount).toBe(0);
  });

  it("re-running an action re-uses its transaction (same hash, no second send)", async () => {
    const { planId } = await purchase();
    const a = await userAction(admin, userId, "prepaid_redeem", { plan_id: crypto.randomUUID(), session_no: 1 });
    const sig = await signedRedeem(chain, planId, 1);
    const first = await adapter.redeem(sig, opts(a));
    const nonce = await relayerNonce();
    const second = await adapter.redeem(sig, opts(a));
    expect(second).toEqual(first);
    expect(await relayerNonce()).toBe(nonce);
    expect((await adapter.readPlan(planId.toString()))?.unitsRedeemed).toBe(1);
    const lookedUp = await adapter.lookup(a.key, userId);
    expect(lookedUp?.status).toBe("confirmed");
    expect(await adapter.lookup(a.key)).toBeNull(); // no user scope, no read
  });

  it("parallel sends from one relayer get distinct, consecutive nonces", async () => {
    // Purchases one by one (each needs the consumer's next permit nonce); the redeems run in parallel.
    const plans: bigint[] = [];
    for (let i = 0; i < 10; i++) plans.push((await purchase(5)).planId);
    const start = await relayerNonce();
    const actions = await Promise.all(plans.map(() => userAction(admin, userId, "prepaid_redeem", { plan_id: crypto.randomUUID(), session_no: 1 })));
    const results = await Promise.all(plans.map(async (id, i) => adapter.redeem(await signedRedeem(chain, id, 1), opts(actions[i]))));
    expect(results.every((r) => r.status === "confirmed")).toBe(true);
    const nonces = (await admin.query("select nonce from public.chain_txs where action_id = any($1::uuid[]) order by nonce", [actions.map((a) => a.id)])).rows.map(
      (r) => Number(r.nonce),
    );
    expect(nonces).toEqual(Array.from({ length: 10 }, (_, i) => start + i));
    expect(await relayerNonce()).toBe(start + 10);
  }, 60_000);

  it("voluntary exit sends the owner's signature and splits the fee on chain", async () => {
    const { planId } = await purchase();
    for (let i = 1; i <= 12; i++) {
      const r = await signedRedeem(chain, planId, i);
      const a = await userAction(admin, userId, "prepaid_redeem", { plan_id: crypto.randomUUID(), session_no: i });
      expect((await adapter.redeem(r, opts(a))).status).toBe("confirmed");
    }
    const consumerBefore = await balanceOf(chain, ADDR.consumer);
    const merchantBefore = await balanceOf(chain, ADDR.merchant);
    const a = await userAction(admin, userId, "prepaid_exit_voluntary", { plan_id: crypto.randomUUID() });
    const res = await adapter.exitVoluntary(await signedVoluntaryExit(chain, planId), opts(a));
    expect(res.status).toBe("confirmed");
    // 48 unused x ¥100 = ¥4,800; 10% fee = ¥480 to the gym, ¥4,320 back to the owner.
    expect((await balanceOf(chain, ADDR.consumer)) - consumerBefore).toBe(BigInt(432_000));
    expect((await balanceOf(chain, ADDR.merchant)) - merchantBefore).toBe(BigInt(48_000));
    expect((await adapter.readPlan(planId.toString()))?.status).toBe("exited_voluntary");
    const row = await admin.query("select sender, method, status from public.chain_txs where action_id = $1", [a.id]);
    expect(row.rows[0]).toEqual({ sender: "relayer", method: "exitVoluntaryBySig", status: "confirmed" });
  });

  it("a voluntary exit signed by someone else is refused in simulation and sends nothing", async () => {
    const { planId } = await purchase();
    const nonce = await relayerNonce();
    const a = await userAction(admin, userId, "prepaid_exit_voluntary", { plan_id: crypto.randomUUID() });
    const forged = await signedVoluntaryExit(chain, planId, KEYS.merchant);
    expect(await adapter.exitVoluntary(forged, opts(a))).toEqual({ status: "reverted", txHash: null, reason: "BadConsumerSig" });
    expect(await relayerNonce()).toBe(nonce);
    expect((await adapter.readPlan(planId.toString()))?.status).toBe("active");
  });

  it("refuses to send without a user, and rejects malformed input before signing", async () => {
    const { planId } = await purchase();
    const sig = await signedRedeem(chain, planId, 1);
    const a = await userAction(admin, userId, "prepaid_redeem", { plan_id: crypto.randomUUID(), session_no: 1 });
    await expect(adapter.redeem(sig, { actionId: a.id, idempotencyKey: a.key })).rejects.toThrow("escrow_user_missing");
    await expect(adapter.redeem({ ...sig, merchantSig: "nope" }, opts(a))).rejects.toThrow("signature_malformed");
    await expect(adapter.redeem({ ...sig, chainPlanId: "1; drop" }, opts(a))).rejects.toThrow("plan_id_malformed");
    const p = await signedPurchase(chain);
    const b = await userAction(admin, userId, "prepaid_purchase", { offer_id: crypto.randomUUID() });
    await expect(adapter.purchase({ ...p, permit: { value: "x" } }, opts(b))).rejects.toThrow("permit_malformed");
    expect((await admin.query("select 1 from public.chain_txs where action_id = any($1::uuid[])", [[a.id, b.id]])).rowCount).toBe(0);
  });

  it("refuses a misconfigured agent key", () => {
    expect(() =>
      createChainEscrow({
        chainId: anvil.id,
        rpcUrls: [chain.rpcUrl],
        escrowAddress: chain.escrow,
        tokenAddress: null,
        relayerKey: KEYS.relayer,
        agentKey: KEYS.agent,
        expectedAgentAddress: ADDR.relayer,
        publicClient: chain.client,
      }),
    ).toThrow("AGENT_ADDRESS does not match");
  });
});
