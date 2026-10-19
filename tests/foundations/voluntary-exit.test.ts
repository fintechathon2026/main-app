// Owner: R3 (roles.md).
// DB integration tests: an approved, unattested prepaid exit settles as a voluntary exit with the
// owner's EIP-712 VoluntaryExit signature (architecture §24.3, §24.5). The consumer key is a
// fresh test key that stays in this file (browser stand-in); the server only stores the
// signature. Skipped when DATABASE_URL is not set (see executor.test.ts for how to run).

import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { PrivateKeyAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actionHash } from "@/src/core/mandate/canonical";
import { getPool, setPool } from "@/src/server/db/pool";
import { getMockbankPool, setMockbankPool } from "@/src/mockbank/db";
import { decideApproval } from "@/src/server/approvals";
import { createExecutor } from "@/src/server/executor";
import { PgPlanStore } from "@/src/server/plan-store";
import { recordVoluntaryExitSignature } from "@/src/server/prepaid/exit-signature";
import { DB_ENABLED, adminPool, createTestUser, inProcessTransport, type TestUser } from "./helpers";
import { setTestOracle } from "./attestations";
import { expectPlanInvariant, newAccount, nowS, signVoluntaryExit } from "./escrow";

const DEFAULT_AGENT = "0xa9e7000000000000000000000000000000000a9e";

describe.skipIf(!DB_ENABLED)("foundations: approved voluntary exit with the owner's signature", () => {
  let admin: Pool;
  /** Mock bank POST bodies, to see exactly what the escrow was sent. */
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
    process.env.AGENT_ADDRESS ??= DEFAULT_AGENT;
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

  type Setup = { u: TestUser; consumer: PrivateKeyAccount; planId: string; chainPlanId: string; actionId: string };

  async function persist(userId: string, tool: string, args: Record<string, unknown>) {
    const planId = await store.createPlan({ userId, trigger: "prepaid_risk", subjectId: randomUUID() });
    const [id] = await store.persistActions({
      planId,
      userId,
      mandateVersion: 3,
      actions: [{ idx: 0, tool, args, argsHash: actionHash(tool, args), idempotencyKey: `test:${randomUUID()}` }],
    });
    return id;
  }

  /** A user whose consumer_browser wallet owns an active mock escrow plan (48 units, 480000 fen, 10% fee). */
  async function setup(): Promise<Setup> {
    const u = await createTestUser(admin, []);
    const consumer = newAccount();
    const merchantId = `TEST_GYM_${randomUUID().slice(0, 8).toUpperCase()}`;
    const merchantAddr = newAccount().address;
    const chainPlanId = String(Date.now()) + String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
    const planId = randomUUID();
    const agent = process.env.AGENT_ADDRESS!;
    await admin.query("insert into public.wallets (user_id, address, kind) values ($1, $2, 'consumer_browser')", [u.id, consumer.address]);
    await admin.query("insert into public.prepaid_merchants (id, name, chain_address, escrow_supported) values ($1, $1, $2, true)", [merchantId, merchantAddr]);
    await admin.query(
      `insert into public.prepaid_plans (id, user_id, chain_plan_id, merchant_id, unit_price, units_total, units_redeemed, cancel_fee_bps,
         agent_address, status, purchase_tx, last_synced_block)
       values ($1, $2, $3, $4, 10000, 48, 0, 1000, $5, 'active', 'mock:test', 0)`,
      [planId, u.id, chainPlanId, merchantId, agent],
    );
    await admin.query(
      `insert into mockbank.escrow_plans (chain_plan_id, owner, merchant, agent, unit_price, units_total, units_redeemed, cancel_fee_bps, status, balance)
       values ($1, $2, $3, $4, 10000, 48, 0, 1000, 'active', 480000)`,
      [chainPlanId, consumer.address, merchantAddr, agent],
    );
    const actionId = await persist(u.id, "prepaid_exit", { plan_id: planId });
    return { u, consumer, planId, chainPlanId, actionId };
  }

  async function signFor(s: Setup, o: { signer?: PrivateKeyAccount; chainPlanId?: string; deadline?: number } = {}) {
    const deadline = o.deadline ?? nowS() + 600;
    return { deadline, consumerSig: await signVoluntaryExit(o.signer ?? s.consumer, o.chainPlanId ?? s.chainPlanId, deadline) };
  }

  const exitCalls = (chainPlanId: string) => sent.filter((x) => x.path.endsWith(`/escrow/plans/${chainPlanId}/exit-voluntary`));
  const escrowStatus = async (chainPlanId: string) =>
    (await admin.query("select status from mockbank.escrow_plans where chain_plan_id = $1", [chainPlanId])).rows[0].status as string;
  const approvalsOf = async (actionId: string) =>
    (await admin.query("select id, status from public.approvals where action_id = $1 order by created_at", [actionId])).rows as {
      id: string;
      status: string;
    }[];

  it("records the owner's signature only for their own open prepaid_exit action", async () => {
    const s = await setup();
    const sig = await signFor(s);
    const other = await createTestUser(admin, []);
    await expect(recordVoluntaryExitSignature(other.id, s.actionId, sig)).rejects.toMatchObject({ code: "not_found" });

    const cancelId = await persist(s.u.id, "cancel_subscription", { subscription_id: randomUUID() });
    await expect(recordVoluntaryExitSignature(s.u.id, cancelId, sig)).rejects.toMatchObject({ code: "wrong_tool" });

    expect(await recordVoluntaryExitSignature(s.u.id, s.actionId, sig)).toEqual({ actionId: s.actionId, deadline: sig.deadline });
    const row = await admin.query("select user_id, deadline::text as deadline, consumer_sig from public.prepaid_exit_signatures where action_id = $1", [
      s.actionId,
    ]);
    expect(row.rows).toEqual([{ user_id: s.u.id, deadline: String(sig.deadline), consumer_sig: sig.consumerSig }]);
    // The audit entry names the action and deadline only; never the signature.
    const audit = await admin.query(
      "select event_json from public.audit_log where user_id = $1 and event_type = 'prepaid.exit_signature_recorded'",
      [s.u.id],
    );
    expect(audit.rows.map((r) => r.event_json)).toEqual([{ actionId: s.actionId, deadline: sig.deadline }]);

    await admin.query("update public.actions set status = 'succeeded' where id = $1", [s.actionId]);
    await expect(recordVoluntaryExitSignature(s.u.id, s.actionId, sig)).rejects.toMatchObject({ code: "action_not_open" });
  });

  it("rejects malformed, expired or foreign-key signatures when recording", async () => {
    const s = await setup();
    const good = await signFor(s);
    for (const bad of [{ ...good, consumerSig: "0x1234" }, { ...good, deadline: 1.5 }, { ...good, signer: "0x00" }, null, "x"]) {
      await expect(recordVoluntaryExitSignature(s.u.id, s.actionId, bad)).rejects.toMatchObject({ code: "invalid" });
    }
    await expect(recordVoluntaryExitSignature(s.u.id, s.actionId, await signFor(s, { deadline: nowS() - 10 }))).rejects.toMatchObject({
      code: "expired",
    });
    await expect(recordVoluntaryExitSignature(s.u.id, s.actionId, await signFor(s, { signer: newAccount() }))).rejects.toMatchObject({
      code: "signature_invalid",
    });
    await expect(recordVoluntaryExitSignature(s.u.id, s.actionId, await signFor(s, { chainPlanId: "1" }))).rejects.toMatchObject({
      code: "signature_invalid",
    });
    const n = await admin.query("select count(*)::int as n from public.prepaid_exit_signatures where action_id = $1", [s.actionId]);
    expect(n.rows[0].n).toBe(0);
  });

  it("user B cannot read user A's stored exit signature", async () => {
    const s = await setup();
    await recordVoluntaryExitSignature(s.u.id, s.actionId, await signFor(s));
    const b = await createTestUser(admin, []);
    const count = async (c: PoolClient) =>
      (await c.query("select count(*)::int as n from public.prepaid_exit_signatures where action_id = $1", [s.actionId])).rows[0].n as number;

    const asJwt = async (sub: string) => {
      const c = await admin.connect();
      try {
        await c.query("begin");
        await c.query("set local role authenticated");
        await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub, role: "authenticated" })]);
        return await count(c);
      } finally {
        await c.query("rollback").catch(() => {});
        c.release();
      }
    };
    expect(await asJwt(b.id)).toBe(0);
    expect(await asJwt(s.u.id)).toBe(1); // sanity: the owner sees it

    const c = await getPool().connect(); // reins_server
    try {
      await c.query("begin");
      await c.query("select set_config('app.user_id', $1, true)", [b.id]);
      expect(await count(c)).toBe(0);
    } finally {
      await c.query("rollback").catch(() => {});
      c.release();
    }
  });

  it("approved exit with a valid owner signature exits once on the mock escrow", async () => {
    const s = await setup();
    const sig = await signFor(s);
    await recordVoluntaryExitSignature(s.u.id, s.actionId, sig);

    const first = await executor.run(s.actionId, s.u.id);
    expect(first.status).toBe("awaiting_approval");
    expect(first.gate?.reasons).toContain("prepaid.exit_needs_confirm");
    const [ap] = await approvalsOf(s.actionId);
    await decideApproval(s.u.id, ap.id, "approve");

    const second = await executor.run(s.actionId, s.u.id);
    expect(second.status).toBe("succeeded");
    expect((second.result as { mode: string }).mode).toBe("voluntary");
    const calls = exitCalls(s.chainPlanId);
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toMatchObject({ deadline: sig.deadline, consumerSig: sig.consumerSig });

    expect(await escrowStatus(s.chainPlanId)).toBe("exited_voluntary");
    const { payouts } = await expectPlanInvariant(admin, s.chainPlanId);
    expect(payouts.map((p) => [p.role, p.amount]).sort()).toEqual([
      ["consumer", "432000"],
      ["merchant", "48000"],
    ]);
    const pp = await admin.query("select status from public.prepaid_plans where id = $1", [s.planId]);
    expect(pp.rows[0].status).toBe("exited_voluntary");
    expect((await approvalsOf(s.actionId)).map((a) => a.status)).toEqual(["consumed"]);

    // Re-running does not exit twice.
    expect((await executor.run(s.actionId, s.u.id)).status).toBe("succeeded");
    expect(exitCalls(s.chainPlanId)).toHaveLength(1);
  });

  it("approved exit whose signature is missing at execution is denied without reserving caps or consuming the approval", async () => {
    const s = await setup();
    await recordVoluntaryExitSignature(s.u.id, s.actionId, await signFor(s));
    expect((await executor.run(s.actionId, s.u.id)).status).toBe("awaiting_approval");
    const [ap] = await approvalsOf(s.actionId);
    await decideApproval(s.u.id, ap.id, "approve");
    const usedBefore = await admin.query("select day::text as day, used::text as used from public.daily_limits where user_id = $1", [s.u.id]);

    await admin.query("delete from public.prepaid_exit_signatures where action_id = $1", [s.actionId]);
    const r = await executor.run(s.actionId, s.u.id);
    expect(r.status).toBe("denied");
    expect(r.gate?.reasons).toContain("prepaid.exit_use_voluntary_flow");

    expect((await approvalsOf(s.actionId)).map((a) => a.status)).toEqual(["expired"]);
    const res = await admin.query("select count(*)::int as n from public.cap_reservations where action_id = $1", [s.actionId]);
    expect(res.rows[0].n).toBe(0);
    const usedAfter = await admin.query("select day::text as day, used::text as used from public.daily_limits where user_id = $1", [s.u.id]);
    expect(usedAfter.rows).toEqual(usedBefore.rows);
    expect(exitCalls(s.chainPlanId)).toHaveLength(0);
    expect(await escrowStatus(s.chainPlanId)).toBe("active");
  });

  it("a signature from another key or for another plan never reaches approval", async () => {
    for (const forged of [{ signer: newAccount() }, { chainPlanId: "1" }]) {
      const s = await setup();
      const sig = await signFor(s, forged);
      // Written past recordVoluntaryExitSignature's checks, as a tampered row would be.
      await admin.query("insert into public.prepaid_exit_signatures (action_id, user_id, deadline, consumer_sig) values ($1, $2, $3, $4)", [
        s.actionId,
        s.u.id,
        sig.deadline,
        sig.consumerSig,
      ]);
      const r = await executor.run(s.actionId, s.u.id);
      expect(r.status).toBe("denied");
      expect(r.gate?.reasons).toContain("prepaid.exit_use_voluntary_flow");
      expect(await approvalsOf(s.actionId)).toEqual([]);
      expect(exitCalls(s.chainPlanId)).toHaveLength(0);
      expect(await escrowStatus(s.chainPlanId)).toBe("active");
    }
  });
});
