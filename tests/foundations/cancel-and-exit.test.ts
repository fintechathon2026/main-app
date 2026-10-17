// DB integration tests: trial auto-cancel (T3) and attested prepaid exit on the mock escrow.
// Skipped when DATABASE_URL is not set (see executor.test.ts for how to run).

import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actionHash } from "@/src/core/mandate/canonical";
import { getPool, setPool } from "@/src/server/db/pool";
import { getMockbankPool, setMockbankPool } from "@/src/mockbank/db";
import { createExecutor } from "@/src/server/executor";
import { PgPlanStore } from "@/src/server/plan-store";
import { DB_ENABLED, adminPool, createTestUser, inProcessTransport } from "./helpers";
import { insertSignedAttestation, randomKey, setTestOracle } from "./attestations";

const AGENT = "0xa9e7000000000000000000000000000000000a9e";

describe.skipIf(!DB_ENABLED)("foundations: cancel and prepaid exit", () => {
  let admin: Pool;
  /** Mock bank request bodies, to see what settlement was sent. */
  const sent: { path: string; body: Record<string, unknown> }[] = [];
  const executor = createExecutor({
    transport: async (req) => {
      const body = req.method === "POST" ? ((await req.clone().json().catch(() => null)) as Record<string, unknown> | null) : null;
      if (body) sent.push({ path: new URL(req.url).pathname, body });
      return inProcessTransport(req);
    },
  });
  const store = new PgPlanStore(executor);
  let restoreOracle: () => void;

  beforeAll(() => {
    process.env.MOCKBANK_API_KEY ??= "test-mockbank-key";
    process.env.AGENT_ADDRESS ??= AGENT;
    restoreOracle = setTestOracle();
    admin = adminPool();
  });

  afterAll(async () => {
    restoreOracle();
    await admin.end();
    await getPool().end();
    setPool(null);
    await getMockbankPool().end();
    setMockbankPool(null);
  });

  async function plan(userId: string, tool: string, args: Record<string, unknown>, trigger: "trial" | "prepaid_risk") {
    const planId = await store.createPlan({ userId, trigger, subjectId: randomUUID() });
    const [id] = await store.persistActions({
      planId,
      userId,
      mandateVersion: 3,
      actions: [{ idx: 0, tool, args, argsHash: actionHash(tool, args), idempotencyKey: `test:${randomUUID()}` }],
    });
    return id;
  }

  async function trialUser(opts: { noticeSent: boolean; origin: string }) {
    const u = await createTestUser(admin, []);
    const subId = randomUUID();
    const m = await admin.query("select id from public.merchants where canonical_name = 'Keep Premium'");
    await admin.query(
      `insert into public.subscriptions (id, user_id, merchant_id, cycle_days, amount, currency, billing_currency, original_amount,
         status, detection_source, trial_end, trial_status_origin, notice_sent)
       values ($1, $2, $3, 30, 28, 'CNY', 'CNY', 28, 'trial', 'mock_bank', now() + interval '1 day', $4, $5)`,
      [subId, u.id, m.rows[0].id, opts.origin, opts.noticeSent],
    );
    await admin.query(
      `insert into mockbank.subscriptions (id, customer_id, merchant_name, amount, currency, cycle_days, status, trial_end)
       values ($1, $2, 'Keep Premium', 28, 'CNY', 30, 'trial', now() + interval '1 day')`,
      [subId, u.id],
    );
    return { u, subId };
  }

  it("auto-cancels a trusted trial without approval (T3)", async () => {
    const { u, subId } = await trialUser({ noticeSent: true, origin: "mock_bank" });
    const id = await plan(u.id, "cancel_subscription", { subscription_id: subId }, "trial");
    const r = await executor.run(id, u.id);
    expect(r.status).toBe("succeeded");
    expect(r.gate?.ruleIds).toContain("subscriptions.auto_cancel_trials");
    const mb = await admin.query("select status from mockbank.subscriptions where id = $1", [subId]);
    expect(mb.rows[0].status).toBe("cancelled");
  });

  it("asks for approval when the trial status came from an email", async () => {
    const { u, subId } = await trialUser({ noticeSent: true, origin: "email" });
    const id = await plan(u.id, "cancel_subscription", { subscription_id: subId }, "trial");
    const r = await executor.run(id, u.id);
    expect(r.status).toBe("awaiting_approval");
    const mb = await admin.query("select status from mockbank.subscriptions where id = $1", [subId]);
    expect(mb.rows[0].status).toBe("trial");
  });

  async function prepaidUser() {
    const u = await createTestUser(admin, []);
    const merchantId = `TEST_GYM_${randomUUID().slice(0, 8).toUpperCase()}`;
    const merchantAddr = "0x" + randomUUID().replace(/-/g, "").padEnd(40, "0").slice(0, 40);
    const owner = "0x" + randomUUID().replace(/-/g, "").padEnd(40, "1").slice(0, 40);
    const chainPlanId = String(Date.now()) + String(Math.floor(Math.random() * 1000));
    const planId = randomUUID();
    await admin.query("insert into public.wallets (user_id, address, kind) values ($1, $2, 'consumer_browser')", [u.id, owner]);
    await admin.query("insert into public.prepaid_merchants (id, name, chain_address, escrow_supported) values ($1, $1, $2, true)", [merchantId, merchantAddr]);
    await admin.query(
      `insert into public.prepaid_plans (id, user_id, chain_plan_id, merchant_id, unit_price, units_total, units_redeemed, cancel_fee_bps,
         agent_address, status, purchase_tx, last_synced_block)
       values ($1, $2, $3, $4, 10000, 60, 12, 1000, $5, 'active', 'mock:test', 0)`,
      [planId, u.id, chainPlanId, merchantId, AGENT],
    );
    await admin.query(
      `insert into mockbank.escrow_plans (chain_plan_id, owner, merchant, agent, unit_price, units_total, units_redeemed, cancel_fee_bps, status, balance)
       values ($1, $2, $3, $4, 10000, 60, 12, 1000, 'active', 480000)`,
      [chainPlanId, owner, merchantAddr, AGENT],
    );
    return { u, planId, merchantId, chainPlanId };
  }

  it("prepaid exit without an attestation or consumer signature is denied (voluntary-exit flow)", async () => {
    const { u, planId, chainPlanId } = await prepaidUser();
    const id = await plan(u.id, "prepaid_exit", { plan_id: planId }, "prepaid_risk");
    const r = await executor.run(id, u.id);
    expect(r.status).toBe("denied");
    expect(r.gate?.ruleIds).toContain("prepaid.auto_exit_on");
    expect(r.gate?.reasons).toContain("prepaid.exit_use_voluntary_flow");
    const ep = await admin.query("select status from mockbank.escrow_plans where chain_plan_id = $1", [chainPlanId]);
    expect(ep.rows[0].status).toBe("active");
  });

  it("attested prepaid exit refunds the owner on the mock escrow", async () => {
    const { u, planId, merchantId, chainPlanId } = await prepaidUser();
    await insertSignedAttestation(admin, { merchantId, caseLabel: randomUUID(), issuedAgoSeconds: 7200, validForSeconds: 7 * 86_400 });
    const id = await plan(u.id, "prepaid_exit", { plan_id: planId }, "prepaid_risk");
    const r = await executor.run(id, u.id);
    expect(r.status).toBe("succeeded");
    expect((r.result as { txHash: string }).txHash).toMatch(/^mock:/);
    const ep = await admin.query("select status, balance from mockbank.escrow_plans where chain_plan_id = $1", [chainPlanId]);
    expect(ep.rows[0]).toMatchObject({ status: "exited_attested", balance: "0" });
    const pp = await admin.query("select status from public.prepaid_plans where id = $1", [planId]);
    expect(pp.rows[0].status).toBe("exited_attested");
    // Re-running does not exit twice.
    expect((await executor.run(id, u.id)).status).toBe("succeeded");
  });

  it("a forged attestation with a tampered sig_valid cache does not authorize an attested exit", async () => {
    const { u, planId, merchantId, chainPlanId } = await prepaidUser();
    await insertSignedAttestation(admin, { merchantId, caseLabel: randomUUID(), signerKey: randomKey(), claimValid: true });
    const id = await plan(u.id, "prepaid_exit", { plan_id: planId }, "prepaid_risk");
    const r = await executor.run(id, u.id);
    expect(r.status).not.toBe("succeeded");
    expect(r.gate?.decision).not.toBe("allow");
    const ep = await admin.query("select status from mockbank.escrow_plans where chain_plan_id = $1", [chainPlanId]);
    expect(ep.rows[0].status).toBe("active");
  });

  it("an attestation signed for another merchant does not authorize an attested exit", async () => {
    const { u, planId, merchantId } = await prepaidUser();
    await insertSignedAttestation(admin, { merchantId, caseLabel: randomUUID(), merchantAddress: "0x" + "ab".repeat(20) });
    const id = await plan(u.id, "prepaid_exit", { plan_id: planId }, "prepaid_risk");
    expect((await executor.run(id, u.id)).status).not.toBe("succeeded");
  });

  it("decides on the newest verified attestation and settles with exactly that id", async () => {
    const { u, planId, merchantId } = await prepaidUser();
    const valid = await insertSignedAttestation(admin, { merchantId, caseLabel: randomUUID(), issuedAgoSeconds: 7200 });
    // Newer records that must not be chosen: a forgery with a tampered cache, and one marked invalid.
    await insertSignedAttestation(admin, { merchantId, caseLabel: randomUUID(), issuedAgoSeconds: 600, signerKey: randomKey(), claimValid: true });
    await insertSignedAttestation(admin, { merchantId, caseLabel: randomUUID(), issuedAgoSeconds: 300, signerKey: randomKey() });
    const id = await plan(u.id, "prepaid_exit", { plan_id: planId }, "prepaid_risk");
    const r = await executor.run(id, u.id);
    expect(r.status).toBe("succeeded");
    const exit = sent.find((s) => s.path.endsWith("/exit-attested") && s.body.idempotency_key !== undefined && s.body.attestation_id === valid);
    expect(exit).toBeDefined();
    const audit = await admin.query(
      "select event_json->>'attestationId' as att from public.audit_log where user_id = $1 and event_type = 'decision' and event_json->>'phase' = 'execute'",
      [u.id],
    );
    expect(audit.rows.map((x) => x.att)).toEqual([valid]);
  });
});
