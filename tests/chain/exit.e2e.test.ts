// End to end on a private anvil and local Supabase (PRD_PrepaidEscrow_Contract §8.5, CG3):
// a plan bought on chain is indexed by chain-sync, a signed attestation arrives, and the
// executor (Gate in the loop) sends exitWithAttestation from the agent key. The refund lands
// with the consumer, a second run sends nothing, and forged or missing evidence sends nothing.

import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { anvil } from "viem/chains";
import { actionHash } from "@/src/core/mandate/canonical";
import { PREPAID_ESCROW_ABI } from "@/src/server/chain/abi";
import { runChainSync } from "@/src/server/chain/indexer";
import { getPool, setPool } from "@/src/server/db/pool";
import { getMockbankPool, setMockbankPool } from "@/src/mockbank/db";
import { createChainEscrow, createExecutor } from "@/src/server/executor";
import { PgPlanStore } from "@/src/server/plan-store";
import { DB_ENABLED, adminPool, createTestUser, inProcessTransport } from "../foundations/helpers";
import { insertSignedAttestation, setTestOracle } from "../foundations/attestations";
import {
  ADDR,
  CHAIN_ENABLED,
  KEYS,
  balanceOf,
  mint,
  resetSenderState,
  sendAs,
  purchaseCallArgs,
  signedPurchase,
  signedRedeem,
  startChain,
  type Chain,
} from "./anvil";

describe.skipIf(!CHAIN_ENABLED || !DB_ENABLED)("chain: attested exit end to end", () => {
  let chain: Chain;
  let admin: Pool;
  let restoreOracle: () => void;
  const saved = { CHAIN_ID: process.env.CHAIN_ID, ESCROW_ADDRESS: process.env.ESCROW_ADDRESS, AGENT_ADDRESS: process.env.AGENT_ADDRESS };
  let executor: ReturnType<typeof createExecutor>;
  let store: PgPlanStore;

  beforeAll(async () => {
    chain = await startChain();
    admin = adminPool();
    restoreOracle = setTestOracle(); // ORACLE_ADDRESS = anvil #1 = the escrow's oracle
    // The Gate verifies attestations over the escrow domain and checks plan.agent == AGENT_ADDRESS.
    process.env.CHAIN_ID = String(anvil.id);
    process.env.ESCROW_ADDRESS = chain.escrow;
    process.env.AGENT_ADDRESS = ADDR.agent;
    process.env.MOCKBANK_API_KEY ??= "test-mockbank-key";
    executor = createExecutor({
      transport: inProcessTransport,
      escrow: createChainEscrow({
        chainId: anvil.id,
        rpcUrls: [chain.rpcUrl],
        escrowAddress: chain.escrow,
        tokenAddress: chain.token,
        relayerKey: KEYS.relayer,
        agentKey: KEYS.agent,
        expectedAgentAddress: ADDR.agent,
        publicClient: chain.client,
      }),
    });
    store = new PgPlanStore(executor);

    // Fresh chain, persistent database: forget what earlier runs indexed and sent.
    await resetSenderState(admin, "agent");
    await admin.query("delete from public.chain_cursors where contract = $1", [`PrepaidEscrow:${chain.escrow.toLowerCase()}`]);
    await admin.query("delete from public.prepaid_plans where purchase_tx like '0x%' and user_id <> '11111111-1111-4111-8111-111111111111'");
    // Plan ids restart at 1 on a fresh chain, and the demo seed's mock plan uses chain_plan_id 1:
    // spend id 1 on a stranger's plan, which no test user's wallet owns.
    const strangerKey = generatePrivateKey();
    const stranger = privateKeyToAccount(strangerKey).address;
    await mint(chain, stranger, BigInt(20_000));
    const p = await signedPurchase(chain, { consumerKey: strangerKey, units: 2 });
    await sendAs(chain, KEYS.relayer, "purchaseWithPermit", purchaseCallArgs(p));
  }, 30_000);

  afterAll(async () => {
    // Leave nothing that a later local chain (same addresses, ids from 1) would collide with.
    if (admin) {
      await admin.query("delete from public.prepaid_plans where purchase_tx like '0x%' and user_id <> '11111111-1111-4111-8111-111111111111'");
      await admin.query("delete from public.chain_cursors where contract = $1", [`PrepaidEscrow:${chain.escrow.toLowerCase()}`]);
      await resetSenderState(admin, "agent");
    }
    restoreOracle?.();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await chain?.stop();
    await admin?.end();
    await getPool().end();
    setPool(null);
    await getMockbankPool().end();
    setMockbankPool(null);
  });

  /** A fresh consumer key with tCNY, registered as a new user's browser wallet. */
  async function walletUser() {
    const u = await createTestUser(admin, []);
    const consumerKey = generatePrivateKey();
    const consumer = privateKeyToAccount(consumerKey).address;
    await mint(chain, consumer, BigInt(1_000_000));
    await admin.query("insert into public.wallets (user_id, address, kind) values ($1, $2, 'consumer_browser')", [u.id, consumer]);
    return { u, consumerKey, consumer };
  }

  /** Lin-like user with a FitBox-like plan bought on chain, and a gym whose chain address is the merchant key. */
  async function linOnChain(opts: { redeemed?: number } = {}) {
    const { u, consumerKey, consumer } = await walletUser();
    const merchantId = `TEST_GYM_${randomUUID().slice(0, 8).toUpperCase()}`;
    await admin.query("insert into public.prepaid_merchants (id, name, chain_address, escrow_supported) values ($1, $1, $2, true)", [merchantId, ADDR.merchant]);

    // Purchase and check-ins happen on chain (the browser and the gym tablet in production).
    const p = await signedPurchase(chain, { consumerKey });
    await sendAs(chain, KEYS.relayer, "purchaseWithPermit", purchaseCallArgs(p));
    const chainPlanId = (await chain.client.readContract({ address: chain.escrow, abi: PREPAID_ESCROW_ABI, functionName: "nextPlanId" })) - BigInt(1);
    for (let s = 1; s <= (opts.redeemed ?? 12); s++) {
      const r = await signedRedeem(chain, chainPlanId, s, { consumer: consumerKey });
      await sendAs(chain, KEYS.relayer, "redeem", [chainPlanId, s, BigInt(r.deadline), r.consumerSig, r.merchantSig]);
    }
    return { u, merchantId, chainPlanId, consumer };
  }

  const sync = (userIds: string[]) =>
    runChainSync(getPool(), { client: chain.client, escrow: chain.escrow, userIds, startBlock: BigInt(0), confirmations: 0 });

  async function exitAction(userId: string, planRowId: string) {
    const planId = await store.createPlan({ userId, trigger: "prepaid_risk", subjectId: randomUUID() });
    const args = { plan_id: planRowId };
    const [id] = await store.persistActions({
      planId,
      userId,
      mandateVersion: 3,
      actions: [{ idx: 0, tool: "prepaid_exit", args, argsHash: actionHash("prepaid_exit", args), idempotencyKey: `test:${randomUUID()}` }],
    });
    return id;
  }

  const agentNonce = () => chain.client.getTransactionCount({ address: ADDR.agent });

  it("indexes the on-chain plan and its sessions for the wallet's owner", async () => {
    const { u, chainPlanId, merchantId } = await linOnChain();
    const stats = await sync([u.id]);
    expect(stats.errors).toEqual([]);
    const plan = await admin.query(
      "select id, merchant_id, unit_price::int, units_total, units_redeemed, status, agent_address, origin from public.prepaid_plans where chain_plan_id = $1",
      [chainPlanId.toString()],
    );
    expect(plan.rows[0]).toMatchObject({ merchant_id: merchantId, unit_price: 10_000, units_total: 60, units_redeemed: 12, status: "active", origin: "chain" });
    expect(plan.rows[0].agent_address.toLowerCase()).toBe(ADDR.agent.toLowerCase());
    const sessions = await admin.query("select count(*)::int as n from public.prepaid_sessions where plan_id = $1", [plan.rows[0].id]);
    expect(sessions.rows[0].n).toBe(12);

    // A second run over the same range changes nothing.
    const again = await sync([u.id]);
    expect(again.plansUpserted).toBe(0);
  }, 60_000);

  it("returns the unused ¥4,800 to the consumer through the agent key, exactly once", async () => {
    const { u, merchantId, chainPlanId, consumer } = await linOnChain();
    await sync([u.id]);
    const planRow = (await admin.query("select id from public.prepaid_plans where chain_plan_id = $1", [chainPlanId.toString()])).rows[0].id as string;
    await insertSignedAttestation(admin, { merchantId, caseLabel: `court:${randomUUID()}` });

    const consumerBefore = await balanceOf(chain, consumer);
    const id = await exitAction(u.id, planRow);
    const r = await executor.run(id, u.id);

    expect(r.status).toBe("succeeded");
    expect(r.gate?.ruleIds).toContain("prepaid.auto_exit_on");
    const result = r.result as { txHash: string; simulated: boolean; mode: string; events: { event: string; args: Record<string, string> }[] };
    expect(result.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(result.simulated).toBe(false);
    expect(result.mode).toBe("attested");
    expect(result.events[0]).toMatchObject({ event: "Exited", args: { planId: chainPlanId.toString(), refund: "480000", fee: "0" } });

    expect((await balanceOf(chain, consumer)) - consumerBefore).toBe(BigInt(480_000));
    const remaining = await chain.client.readContract({ address: chain.escrow, abi: PREPAID_ESCROW_ABI, functionName: "remaining", args: [chainPlanId] });
    expect(remaining).toBe(BigInt(0));
    const tx = await admin.query("select sender, method, status from public.chain_txs where action_id = $1", [id]);
    expect(tx.rows[0]).toEqual({ sender: "agent", method: "exitWithAttestation", status: "confirmed" });
    const audit = await admin.query(
      "select count(*)::int as n from public.audit_log where user_id = $1 and event_type = 'execution.succeeded'",
      [u.id],
    );
    expect(audit.rows[0].n).toBe(1);

    // Re-running the action is idempotent: same result, no transaction.
    const nonce = await agentNonce();
    const again = await executor.run(id, u.id);
    expect(again.status).toBe("succeeded");
    expect(await agentNonce()).toBe(nonce);

    // The indexer agrees with the executor's view.
    await sync([u.id]);
    const st = await admin.query("select status from public.prepaid_plans where id = $1", [planRow]);
    expect(st.rows[0].status).toBe("exited_attested");
  }, 60_000);

  it("a forged attestation is denied by the Gate and nothing is sent", async () => {
    const { u, merchantId, chainPlanId } = await linOnChain({ redeemed: 2 });
    await sync([u.id]);
    const planRow = (await admin.query("select id from public.prepaid_plans where chain_plan_id = $1", [chainPlanId.toString()])).rows[0].id as string;
    // Signed by another key but stored as if valid (a tampered cache): the Gate re-verifies.
    await insertSignedAttestation(admin, {
      merchantId,
      caseLabel: `forged:${randomUUID()}`,
      signerKey: KEYS.deployer,
      claimValid: true,
    });
    const nonce = await agentNonce();
    const id = await exitAction(u.id, planRow);
    const r = await executor.run(id, u.id);
    expect(r.status).toBe("denied");
    expect(r.gate?.reasons).toContain("prepaid.exit_use_voluntary_flow");
    expect(await agentNonce()).toBe(nonce);
    expect((await admin.query("select 1 from public.chain_txs where action_id = $1", [id])).rowCount).toBe(0);
    const plan = await chain.client.readContract({ address: chain.escrow, abi: PREPAID_ESCROW_ABI, functionName: "getPlan", args: [chainPlanId] });
    expect(plan.status).toBe(1); // still Active
  }, 60_000);

  it("skips plans of merchants Reins does not know", async () => {
    const { u, consumerKey } = await walletUser();
    const stranger = "0x2a871d0798f97d79848a013d4936a73bf4cc922c4d0e5e7b6d0a6d3f6b62e6a4" as const;
    const p = await signedPurchase(chain, { consumerKey, merchantKey: stranger, units: 2 });
    await sendAs(chain, KEYS.relayer, "purchaseWithPermit", purchaseCallArgs(p));
    const stats = await sync([u.id]);
    expect(stats.unknownMerchant).toBe(1);
    expect(stats.plansUpserted).toBe(0);
    expect(stats.errors).toEqual([]);
  }, 60_000);
});
