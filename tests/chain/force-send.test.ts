// Eval force-send (architecture §24.5, R2-11): with EVAL_FORCE_SEND_REVERTS the chain adapter
// skips simulation, so attack transactions are mined as reverts and recorded in chain_txs with
// their decoded reason. Without it nothing is sent. Private anvil only; never a public network.
//
// This suite uses its own relayer and agent keys (anvil #6, #7) with nonces moved far up, and a
// plan id far above the other suites' (nextPlanId is storage slot 2), so it shares no
// chain_txs (sender, nonce) pair, chain_nonces row or chain_plan_id with suites running in parallel.

import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { pad, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { anvil } from "viem/chains";
import { actionHash } from "@/src/core/mandate/canonical";
import { PREPAID_ESCROW_ABI } from "@/src/server/chain/abi";
import { escrowDomain } from "@/src/server/chain/eip712";
import { getPool, setPool } from "@/src/server/db/pool";
import { getMockbankPool, setMockbankPool } from "@/src/mockbank/db";
import { createChainEscrow, createExecutor, type ChainEscrowAdapter } from "@/src/server/executor";
import { sendRevertEvidence } from "../../scripts/force-send-reverts-main";
import { DB_ENABLED, adminPool, createTestUser, inProcessTransport } from "../foundations/helpers";
import { ADDR, CHAIN_ENABLED, KEYS, balanceOf, mint, sendAs, signedPurchase, signedRedeem, startChain, type Chain } from "./anvil";

// anvil test accounts #6 and #7 (public test keys; never use on a real network)
const RELAYER = "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e" as const;
const AGENT = "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356" as const;
const RELAYER_ADDR = privateKeyToAccount(RELAYER).address;
const AGENT_ADDR = privateKeyToAccount(AGENT).address;
const NONCE_BASE = 5_000_000 + Math.floor(Math.random() * 1_000_000);
const PLAN_BASE = BigInt(7_000_000 + Math.floor(Math.random() * 1_000_000));

describe.skipIf(!CHAIN_ENABLED || !DB_ENABLED)("chain: eval force-send of attack transactions", () => {
  let chain: Chain;
  let admin: Pool;
  let userId: string;
  let forced: ChainEscrowAdapter;
  let plain: ChainEscrowAdapter;

  const adapter = (forceSendReverts: boolean) =>
    createChainEscrow({
      chainId: anvil.id,
      rpcUrls: [chain.rpcUrl],
      escrowAddress: chain.escrow,
      tokenAddress: chain.token,
      relayerKey: RELAYER,
      agentKey: AGENT,
      expectedAgentAddress: AGENT_ADDR,
      publicClient: chain.client,
      forceSendReverts,
    });

  const rpc = (method: string, params: unknown[]) => (chain.client.request as (a: { method: string; params: unknown[] }) => Promise<unknown>)({ method, params });
  const nonceOf = (a: Hex) => chain.client.getTransactionCount({ address: a });
  const domain = () => escrowDomain({ chainId: anvil.id, escrowAddress: chain.escrow });

  async function cleanup() {
    await admin.query("delete from public.chain_txs where user_id = $1", [userId]);
    await admin.query("delete from public.chain_nonces where sender = any($1::text[])", [[RELAYER_ADDR.toLowerCase(), AGENT_ADDR.toLowerCase()]]);
    await admin.query("delete from public.prepaid_plans where user_id = $1", [userId]);
  }

  beforeAll(async () => {
    chain = await startChain();
    admin = adminPool();
    userId = (await createTestUser(admin, [])).id;
    process.env.MOCKBANK_API_KEY ??= "test-mockbank-key";
    for (const a of [RELAYER_ADDR, AGENT_ADDR]) await rpc("anvil_setNonce", [a, toHex(NONCE_BASE)]);
    await rpc("anvil_setStorageAt", [chain.escrow, toHex(2, { size: 32 }), pad(toHex(PLAN_BASE), { size: 32 })]);
    forced = adapter(true);
    plain = adapter(false);
    await mint(chain, ADDR.consumer, BigInt(10_000_000));
  }, 30_000);

  afterAll(async () => {
    if (admin && userId) await cleanup();
    await chain?.stop();
    await admin?.end();
    await getPool().end();
    setPool(null);
    await getMockbankPool().end();
    setMockbankPool(null);
  });

  /** A plan bought on chain whose named agent is this suite's agent key, with `redeemed` check-ins. */
  async function plan(redeemed = 2): Promise<bigint> {
    const p = await signedPurchase(chain, { agent: AGENT_ADDR, units: 10 });
    await sendAs(chain, KEYS.deployer, "purchaseWithPermit", [p.offer, p.merchantSig, p.auth, p.consumerSig, p.permit]);
    const id = (await chain.client.readContract({ address: chain.escrow, abi: PREPAID_ESCROW_ABI, functionName: "nextPlanId" })) - BigInt(1);
    for (let s = 1; s <= redeemed; s++) {
      const r = await signedRedeem(chain, id, s);
      await sendAs(chain, KEYS.deployer, "redeem", [id, s, r.deadline, r.consumerSig, r.merchantSig]);
    }
    return id;
  }

  it("moved the plan id range away from the other suites", async () => {
    expect(await plan(0)).toBeGreaterThanOrEqual(PLAN_BASE);
  });

  it("without the flag the attacks are caught in simulation and nothing is sent", async () => {
    const id = await plan();
    const before = { relayer: await nonceOf(RELAYER_ADDR), agent: await nonceOf(AGENT_ADDR) };
    const r = await sendRevertEvidence({ adapter: plain, userId, chainPlanId: id.toString(), domain: domain(), merchantKey: KEYS.merchant });
    expect(r.map((x) => [x.name, x.status, x.txHash, x.reason])).toEqual([
      ["forged_attestation_exit", "reverted", null, "BadOracleSig"],
      ["merchant_only_checkin", "reverted", null, "BadConsumerSig"],
      ["out_of_order_checkin", "reverted", null, "WrongSession"],
    ]);
    expect({ relayer: await nonceOf(RELAYER_ADDR), agent: await nonceOf(AGENT_ADDR) }).toEqual(before);
    const rows = await admin.query("select 1 from public.chain_txs where action_id = any($1::uuid[])", [r.map((x) => x.actionId)]);
    expect(rows.rowCount).toBe(0);
  }, 60_000);

  it("with the flag each attack is mined as a reverted transaction and recorded with its reason", async () => {
    const id = await plan();
    const escrowBefore = await balanceOf(chain, chain.escrow);
    const r = await sendRevertEvidence({ adapter: forced, userId, chainPlanId: id.toString(), domain: domain(), merchantKey: KEYS.merchant });
    expect(r.map((x) => [x.name, x.status, x.reason])).toEqual([
      ["forged_attestation_exit", "reverted", "BadOracleSig"],
      ["merchant_only_checkin", "reverted", "BadConsumerSig"],
      ["out_of_order_checkin", "reverted", "WrongSession"],
    ]);
    for (const x of r) {
      expect(x.txHash).toMatch(/^0x[0-9a-f]{64}$/);
      const receipt = await chain.client.getTransactionReceipt({ hash: x.txHash as Hex });
      expect(receipt.status).toBe("reverted");
      expect(receipt.gasUsed).toBeLessThan(BigInt(500_000));
    }
    const rows = await admin.query(
      "select action_id, sender, method, status, tx_hash, revert_reason, nonce from public.chain_txs where action_id = any($1::uuid[])",
      [r.map((x) => x.actionId)],
    );
    const byAction = new Map(rows.rows.map((row) => [row.action_id, row]));
    expect(r.map((x) => byAction.get(x.actionId))).toMatchObject([
      { sender: "agent", method: "exitWithAttestation", status: "reverted", tx_hash: r[0].txHash, revert_reason: "BadOracleSig" },
      { sender: "relayer", method: "redeem", status: "reverted", tx_hash: r[1].txHash, revert_reason: "BadConsumerSig" },
      { sender: "relayer", method: "redeem", status: "reverted", tx_hash: r[2].txHash, revert_reason: "WrongSession" },
    ]);
    for (const row of rows.rows) expect(Number(row.nonce)).toBeGreaterThanOrEqual(NONCE_BASE);

    // No money moved and the plan is untouched.
    expect(await balanceOf(chain, chain.escrow)).toBe(escrowBefore);
    expect(await forced.readPlan(id.toString())).toMatchObject({ status: "active", unitsRedeemed: 2 });

    // A retry of the same action re-uses the recorded transaction (no second send).
    const nonce = await nonceOf(RELAYER_ADDR);
    const retry = await forced.redeem(
      { chainPlanId: id.toString(), sessionNo: 4, deadline: 0, consumerSig: `0x${"11".repeat(65)}`, merchantSig: `0x${"11".repeat(65)}` },
      { actionId: r[2].actionId, idempotencyKey: "unused", userId },
    );
    expect(retry).toEqual({ status: "reverted", txHash: r[2].txHash, reason: "WrongSession" });
    expect(await nonceOf(RELAYER_ADDR)).toBe(nonce);
  }, 60_000);

  it("through the executor (eval arm A), a merchant-only check-in fails definitively with the on-chain reason", async () => {
    const id = await plan();
    const merchantId = `TEST_GYM_FS_${randomUUID().slice(0, 8).toUpperCase()}`;
    await admin.query("insert into public.prepaid_merchants (id, name, chain_address, escrow_supported) values ($1, $1, $2, true)", [merchantId, ADDR.merchant]);
    const planRow = await admin.query(
      `insert into public.prepaid_plans (user_id, chain_plan_id, merchant_id, unit_price, units_total, units_redeemed, cancel_fee_bps,
         agent_address, status, purchase_tx, origin, last_synced_block)
       values ($1, $2, $3, 10000, 10, 2, 1000, $4, 'active', $5, 'chain', 0) returning id`,
      [userId, id.toString(), merchantId, AGENT_ADDR, `eval:force-send:${randomUUID()}`],
    );
    const plans = await admin.query("insert into public.plans (user_id, trigger, subject_id, status) values ($1, 'user_action', $2, 'running') returning id", [
      userId,
      randomUUID(),
    ]);
    const args = { plan_id: planRow.rows[0].id, session_no: 3 };
    const action = await admin.query(
      `insert into public.actions (plan_id, user_id, idx, tool, actor, args_json, args_hash, mandate_version, idempotency_key)
       values ($1, $2, 0, 'prepaid_redeem', 'user', $3, $4, 3, $5) returning id`,
      [plans.rows[0].id, userId, JSON.stringify(args), actionHash("prepaid_redeem", args), `test:${randomUUID()}`],
    );
    const actionId = action.rows[0].id as string;
    // Merchant-only: the "consumer" signature is the merchant's own.
    const sig = await signedRedeem(chain, id, 3, { consumer: KEYS.merchant });
    await admin.query("insert into public.prepaid_action_signatures (action_id, user_id, tool, payload) values ($1, $2, 'prepaid_redeem', $3)", [
      actionId,
      userId,
      JSON.stringify({ sessionNo: 3, deadline: Number(sig.deadline), consumerSig: sig.consumerSig, merchantSig: sig.merchantSig }),
    ]);

    vi.stubEnv("REINS_EVAL_DISABLE_GATE", "1");
    let executor;
    try {
      executor = createExecutor({ transport: inProcessTransport, escrow: forced, evalDisableGate: true });
    } finally {
      vi.unstubAllEnvs();
    }
    const r = await executor.run(actionId, userId);
    expect(r.status).toBe("failed");
    expect(r.error).toBe("BadConsumerSig");
    const tx = await admin.query("select status, tx_hash, revert_reason from public.chain_txs where action_id = $1", [actionId]);
    expect(tx.rows[0]).toMatchObject({ status: "reverted", revert_reason: "BadConsumerSig" });
    expect(tx.rows[0].tx_hash).toMatch(/^0x[0-9a-f]{64}$/);
    const row = await admin.query("select status from public.actions where id = $1", [actionId]);
    expect(row.rows[0].status).toBe("failed");
    expect(await forced.readPlan(id.toString())).toMatchObject({ status: "active", unitsRedeemed: 2 });
  }, 60_000);

  it("refuses force-send in a deployed environment", () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(() => adapter(true)).toThrow(/eval runs only/);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
