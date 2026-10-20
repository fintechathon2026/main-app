// DB integration tests: user-initiated prepaid actions (R2-06, architecture §8.2, §24.10). The
// user buys, checks in and leaves through the SAME executor and Gate as agent actions, on the mock
// escrow. Keys are fresh test keys kept in this file (browser and gym stand-ins); the server only
// sees signatures. Skipped when DATABASE_URL is not set (see executor.test.ts for how to run).

import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getMockbankPool, setMockbankPool } from "@/src/mockbank/db";
import { verifyAuditChain } from "@/src/server/audit";
import { getPool, setPool } from "@/src/server/db/pool";
import { DB_ENABLED, adminPool, createTestUser, inProcessTransport, type TestUser } from "./helpers";
import { newParties, nowS, redeemBody, signPurchase, signVoluntaryExit, type Parties } from "./escrow";

process.env.MOCKBANK_API_KEY ??= "test-mockbank-key"; // before the adapters read it

// The routes call getExecutor(); route it to the in-process mock bank (built on first use).
vi.mock("@/src/server/executor", async (orig) => {
  const actual = await orig<typeof import("@/src/server/executor")>();
  let executor: ReturnType<typeof actual.createExecutor> | null = null;
  return { ...actual, getExecutor: () => (executor ??= actual.createExecutor({ transport: inProcessTransport })) };
});

const { purchase, checkin, exitVoluntary, registerWallet } = await import("@/src/server/prepaid/user-actions");

describe.skipIf(!DB_ENABLED)("foundations: user-initiated prepaid actions", () => {
  let admin: Pool;
  let u: TestUser;
  let p: Parties;
  let offerId: string;
  const merchantId = `TEST_GYM_${randomUUID().slice(0, 8).toUpperCase()}`;

  beforeAll(async () => {
    admin = adminPool();
    p = newParties();
    process.env.AGENT_ADDRESS = p.agent.address;
    u = await createTestUser(admin, []);
    await admin.query(
      `insert into public.prepaid_merchants (id, name, chain_address, escrow_supported, risk_level) values ($1, 'Test Gym', $2, true, 'none')`,
      [merchantId, p.merchant.address],
    );
    const o = await admin.query(
      `insert into public.prepaid_offers (merchant_id, unit_price, units, cancel_fee_bps, pay_per_visit_price, expires_at, offer_json, merchant_sig)
       values ($1, 10000, 10, 1000, 12500, now() + interval '2 hours', '{}', 'mock:unsigned') returning id`,
      [merchantId],
    );
    offerId = o.rows[0].id;
  });

  afterAll(async () => {
    // Offers and merchants are reference tables every user sees: remove what this file added.
    await admin.query("delete from public.prepaid_plans where merchant_id = $1", [merchantId]);
    await admin.query("delete from public.prepaid_offers where merchant_id = $1", [merchantId]);
    await admin.query("delete from public.prepaid_merchants where id = $1", [merchantId]);
    await admin.end();
    await getPool().end();
    setPool(null);
    await getMockbankPool().end();
    setMockbankPool(null);
  });

  it("refuses to run without a registered browser wallet", async () => {
    const body = await signPurchase(p);
    await expect(purchase(u.id, { offerId, ...body } as never)).rejects.toMatchObject({ code: "no_wallet" });
  });

  it("buys, checks in and leaves, each through the Gate, with the money going where the escrow says", async () => {
    await registerWallet(u.id, p.consumer.address);

    const body = await signPurchase(p);
    const bought = await purchase(u.id, { offerId, ...body } as never);
    expect(bought).toMatchObject({ status: "succeeded", decision: "allow" });
    expect(bought.ruleIds).toEqual(expect.arrayContaining(["prepaid.purchase", "prepaid.offer_valid", "prepaid.escrow_only", "prepaid.max_prepay"]));
    expect(bought.tx?.simulated).toBe(true);

    const plan = (
      await admin.query("select id, chain_plan_id::text as chain_plan_id, units_total, units_redeemed, status from public.prepaid_plans where user_id = $1", [u.id])
    ).rows[0];
    expect(plan).toMatchObject({ units_total: 10, units_redeemed: 0, status: "active" });

    const session = await checkin(u.id, plan.id, await redeemBody(p, plan.chain_plan_id, 1));
    expect(session).toMatchObject({ status: "succeeded", decision: "allow" });
    expect((await admin.query("select units_redeemed from public.prepaid_plans where id = $1", [plan.id])).rows[0].units_redeemed).toBe(1);

    const deadline = nowS() + 600;
    const left = await exitVoluntary(u.id, plan.id, { deadline, consumerSig: await signVoluntaryExit(p.consumer, plan.chain_plan_id, deadline) });
    expect(left).toMatchObject({ status: "succeeded", decision: "allow" });
    expect((await admin.query("select status from public.prepaid_plans where id = $1", [plan.id])).rows[0].status).toBe("exited_voluntary");

    const actors = await admin.query("select tool, actor, status from public.actions where user_id = $1 order by created_at", [u.id]);
    expect(actors.rows).toEqual([
      { tool: "prepaid_purchase", actor: "user", status: "succeeded" },
      { tool: "prepaid_redeem", actor: "user", status: "succeeded" },
      { tool: "prepaid_exit_voluntary", actor: "user", status: "succeeded" },
    ]);
    expect((await verifyAuditChain(u.id)).ok).toBe(true);
  });

  it("denies a purchase whose offer terms differ from the stored offer, and never calls the escrow", async () => {
    const forged = await signPurchase(p, { offer: { unitPrice: 1 } }); // the gym signed, but not these terms
    const r = await purchase(u.id, { offerId, ...forged } as never);
    expect(r).toMatchObject({ status: "denied", decision: "deny" });
    expect(r.tx).toBeNull();
  });

  it("denies a check-in the gym did not sign", async () => {
    await registerWallet(u.id, p.consumer.address);
    const bought = await purchase(u.id, { offerId, ...(await signPurchase(p)) } as never);
    expect(bought.status).toBe("succeeded");
    const plan = (
      await admin.query("select id, chain_plan_id::text as chain_plan_id from public.prepaid_plans where user_id = $1 and status = 'active' order by chain_plan_id desc limit 1", [u.id])
    ).rows[0];
    const body = await redeemBody(p, plan.chain_plan_id, 1);
    const consumerOnly = { ...body, merchantSig: body.consumerSig }; // T22: one party signs both
    const r = await checkin(u.id, plan.id, consumerOnly);
    expect(r).toMatchObject({ status: "denied", decision: "deny" });
  });
});
