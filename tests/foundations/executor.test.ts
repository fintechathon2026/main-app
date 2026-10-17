// DB integration tests for the executor, approvals, audit chain, mock bank and RLS.
// Run against local Supabase: `pnpm exec supabase start && pnpm exec supabase db reset`, then
// `set -a; . ./.env.local; set +a; pnpm test`. Skipped when DATABASE_URL is not set.

import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPool, setPool } from "@/src/server/db/pool";
import { getMockbankPool, setMockbankPool } from "@/src/mockbank/db";
import { createExecutor } from "@/src/server/executor";
import { PgPlanStore } from "@/src/server/plan-store";
import { decideApproval } from "@/src/server/approvals";
import { verifyAuditChain } from "@/src/server/audit";
import { DB_ENABLED, adminPool, createTestUser, inProcessTransport, planPayments } from "./helpers";

describe.skipIf(!DB_ENABLED)("foundations: executor against Postgres + mock bank", () => {
  let admin: Pool;
  const executor = createExecutor({ transport: inProcessTransport });
  const store = new PgPlanStore(executor);

  beforeAll(() => {
    process.env.MOCKBANK_API_KEY ??= "test-mockbank-key";
    admin = adminPool();
  });

  afterAll(async () => {
    await admin.end();
    await getPool().end();
    setPool(null);
    await getMockbankPool().end();
    setMockbankPool(null);
  });

  const payments = async (billId: string) =>
    (await admin.query("select id, amount from mockbank.payments where bill_id = $1", [billId])).rows;

  it("pays a bill under auto_pay_max once; a duplicate run is idempotent", async () => {
    const u = await createTestUser(admin, [{ biller: "CHINA_MOBILE", amount: 98, key: "mobile" }]);
    const { ids } = await planPayments(store, u.id, [{ billId: u.bills.mobile, billerId: "CHINA_MOBILE", amount: 98 }]);

    const preview = await store.previewDecision(ids[0], u.id);
    expect(preview.decision).toBe("allow");

    const first = await executor.run(ids[0], u.id);
    expect(first.status).toBe("succeeded");
    const second = await executor.run(ids[0], u.id);
    expect(second.status).toBe("succeeded");
    expect(second.result).toEqual(first.result);

    // Two concurrent re-runs still do nothing new.
    await Promise.all([executor.run(ids[0], u.id), executor.run(ids[0], u.id)]);
    expect(await payments(u.bills.mobile)).toHaveLength(1);

    const lim = await admin.query("select used from public.daily_limits where user_id = $1", [u.id]);
    expect(Number(lim.rows[0].used)).toBe(98);
    const rows = await store.auditRowsForPlan((await admin.query("select plan_id from public.actions where id = $1", [ids[0]])).rows[0].plan_id, u.id);
    expect(rows[0]).toMatchObject({ tool: "pay_bill", decision: "allow", amount: 98, currency: "CNY", payeeName: "CHINA_MOBILE" });
    expect(rows[0].txHash).toBeTruthy();
  });

  it("labels the feed amount with the bill's currency, not the user's base currency", async () => {
    const u = await createTestUser(admin, [{ biller: "CHINA_MOBILE", amount: 20, key: "mobile" }]);
    await admin.query("update public.bills set currency = 'USD' where id = $1", [u.bills.mobile]);
    const { planId } = await planPayments(store, u.id, [{ billId: u.bills.mobile, billerId: "CHINA_MOBILE", amount: 20 }]);
    const rows = await store.auditRowsForPlan(planId, u.id);
    expect(rows[0]).toMatchObject({ tool: "pay_bill", amount: 20, currency: "USD" });
  });

  it("denies an amount that does not match the bill row", async () => {
    const u = await createTestUser(admin, [{ biller: "CHINA_MOBILE", amount: 98, key: "mobile" }]);
    const { ids } = await planPayments(store, u.id, [{ billId: u.bills.mobile, billerId: "CHINA_MOBILE", amount: 97 }]);
    const r = await executor.run(ids[0], u.id);
    expect(r.status).toBe("denied");
    expect(r.gate?.ruleIds).toContain("provenance.amount_mismatch");
    expect(await payments(u.bills.mobile)).toHaveLength(0);
  });

  it("denies a biller that differs from the bill's biller (destination from registry only)", async () => {
    const u = await createTestUser(admin, [{ biller: "CHINA_MOBILE", amount: 98, key: "mobile" }]);
    const { ids } = await planPayments(store, u.id, [{ billId: u.bills.mobile, billerId: "SZ_POWER", amount: 98 }]);
    const r = await executor.run(ids[0], u.id);
    expect(r.status).toBe("denied");
    expect(r.gate?.ruleIds).toContain("provenance.destination");
  });

  it("anomalous bill waits for approval, then succeeds exactly once after approve", async () => {
    const u = await createTestUser(admin, [{ biller: "SZ_POWER", amount: 612, key: "power" }]);
    const { ids } = await planPayments(store, u.id, [{ billId: u.bills.power, billerId: "SZ_POWER", amount: 612 }]);

    expect((await store.previewDecision(ids[0], u.id)).decision).toBe("require_confirm");
    const waiting = await executor.run(ids[0], u.id);
    expect(waiting.status).toBe("awaiting_approval");
    expect(waiting.gate?.ruleIds).toEqual(expect.arrayContaining(["bills.anomaly", "bills.auto_pay_max"]));
    expect(await payments(u.bills.power)).toHaveLength(0);

    const approvalId = await store.createApproval(ids[0], u.id);
    expect(await store.createApproval(ids[0], u.id)).toBe(approvalId); // one open approval per hash

    // Another user cannot approve it.
    const other = await createTestUser(admin, []);
    await expect(decideApproval(other.id, approvalId, "approve")).rejects.toThrow("not_found");

    await decideApproval(u.id, approvalId, "approve");
    const done = await executor.run(ids[0], u.id);
    expect(done.status).toBe("succeeded");
    expect(done.gate?.ruleIds).toContain("approval.valid");

    const ap = await admin.query("select status, consumed_at from public.approvals where id = $1", [approvalId]);
    expect(ap.rows[0].status).toBe("consumed");
    expect((await executor.run(ids[0], u.id)).status).toBe("succeeded");
    expect(await payments(u.bills.power)).toHaveLength(1);
  });

  it("execution that needs confirmation creates the approval itself, even when preview said allow", async () => {
    const u = await createTestUser(admin, [{ biller: "SZ_POWER", amount: 612, key: "power" }]);
    const { ids } = await planPayments(store, u.id, [{ billId: u.bills.power, billerId: "SZ_POWER", amount: 612 }]);
    // Preview recorded allow (e.g. before the bill or limits changed); no approval row exists.
    await admin.query("update public.actions set preview_decision = 'allow', status = 'ready' where id = $1", [ids[0]]);
    const r = await executor.run(ids[0], u.id);
    expect(r.status).toBe("awaiting_approval");
    const ap = await admin.query("select status from public.approvals where action_id = $1", [ids[0]]);
    expect(ap.rows.map((x) => x.status)).toEqual(["pending"]);
    // A second run reuses the open approval instead of piling up cards.
    await executor.run(ids[0], u.id);
    expect((await admin.query("select 1 from public.approvals where action_id = $1", [ids[0]])).rowCount).toBe(1);
  });

  it("a rejected approval never executes", async () => {
    const u = await createTestUser(admin, [{ biller: "SZ_POWER", amount: 612, key: "power" }]);
    const { ids } = await planPayments(store, u.id, [{ billId: u.bills.power, billerId: "SZ_POWER", amount: 612 }]);
    await store.previewDecision(ids[0], u.id);
    const approvalId = await store.createApproval(ids[0], u.id);
    await decideApproval(u.id, approvalId, "reject", "not now");
    const r = await executor.run(ids[0], u.id);
    expect(r.status).toBe("rejected");
    expect(await payments(u.bills.power)).toHaveLength(0);
  });

  it("20 parallel payments never exceed the daily cap (G4)", async () => {
    const bills = Array.from({ length: 20 }, (_, i) => ({ biller: "CHINA_MOBILE", amount: 98, key: `b${i}` }));
    const u = await createTestUser(admin, bills);
    const { ids } = await planPayments(
      store,
      u.id,
      bills.map((b) => ({ billId: u.bills[b.key], billerId: "CHINA_MOBILE", amount: 98 })),
    );
    const results = await Promise.all(ids.map((id) => executor.run(id, u.id)));
    const ok = results.filter((r) => r.status === "succeeded");
    const denied = results.filter((r) => r.status === "denied");
    expect(ok.length).toBe(Math.floor(1000 / 98));
    expect(ok.length + denied.length).toBe(20);
    for (const d of denied) expect(d.gate?.ruleIds).toContain("global.daily_outflow_cap");

    const lim = await admin.query("select used from public.daily_limits where user_id = $1", [u.id]);
    expect(Number(lim.rows[0].used)).toBe(ok.length * 98);
    expect(Number(lim.rows[0].used)).toBeLessThanOrEqual(1000);
    const paid = await admin.query("select coalesce(sum(amount), 0)::int as s from mockbank.payments where customer_id = $1", [u.id]);
    expect(paid.rows[0].s).toBeLessThanOrEqual(1000);
  });

  it("kill switch denies execution", async () => {
    const u = await createTestUser(admin, [{ biller: "CHINA_MOBILE", amount: 98, key: "mobile" }]);
    await admin.query("update public.kill_switch set enabled = true where user_id = $1", [u.id]);
    const { ids } = await planPayments(store, u.id, [{ billId: u.bills.mobile, billerId: "CHINA_MOBILE", amount: 98 }]);
    expect((await store.loadContext(u.id)).killSwitch).toBe(true);
    const r = await executor.run(ids[0], u.id);
    expect(r.status).toBe("denied");
    expect(r.gate?.ruleIds).toEqual(["global.kill_switch"]);
  });

  it("refuses an action whose stored args no longer match its hash", async () => {
    const u = await createTestUser(admin, [{ biller: "CHINA_MOBILE", amount: 98, key: "mobile" }]);
    const { ids } = await planPayments(store, u.id, [{ billId: u.bills.mobile, billerId: "CHINA_MOBILE", amount: 98 }]);
    await admin.query("update public.actions set args_json = jsonb_set(args_json, '{amount}', '9800') where id = $1", [ids[0]]);
    const r = await executor.run(ids[0], u.id);
    expect(r.error).toBe("hash_mismatch");
    expect(await payments(u.bills.mobile)).toHaveLength(0);
  });

  it("keeps a verifiable hash chain in the audit log, and the log is append-only", async () => {
    const u = await createTestUser(admin, [{ biller: "CHINA_MOBILE", amount: 98, key: "mobile" }]);
    const { ids } = await planPayments(store, u.id, [{ billId: u.bills.mobile, billerId: "CHINA_MOBILE", amount: 98 }]);
    await store.previewDecision(ids[0], u.id);
    await executor.run(ids[0], u.id);
    const v = await verifyAuditChain(u.id);
    expect(v.ok).toBe(true);
    expect(v.count).toBeGreaterThanOrEqual(4);

    const server = getPool();
    await expect(server.query("update public.audit_log set event_type = 'x' where user_id = $1", [u.id])).rejects.toThrow();
    await expect(admin.query("delete from public.audit_log where user_id = $1", [u.id])).rejects.toThrow(/append-only/);
  });

  it("RLS: a second user reads 0 rows of the first user's data", async () => {
    const a = await createTestUser(admin, [{ biller: "CHINA_MOBILE", amount: 98, key: "mobile" }]);
    await planPayments(store, a.id, [{ billId: a.bills.mobile, billerId: "CHINA_MOBILE", amount: 98 }]);
    const b = await createTestUser(admin, []);
    const c = await getPool().connect();
    try {
      for (const table of ["bills", "actions", "mandates", "billers", "audit_log", "plans"]) {
        await c.query("begin");
        await c.query("select set_config('app.user_id', $1, true)", [b.id]);
        const r = await c.query(`select count(*)::int as n from public.${table} where user_id = $1`, [a.id]);
        expect(r.rows[0].n, table).toBe(0);
        await c.query("rollback");
      }
      // Without app.user_id the server role sees nothing at all.
      const none = await c.query("select count(*)::int as n from public.bills");
      expect(none.rows[0].n).toBe(0);
      // And it cannot write rows for another user.
      await c.query("begin");
      await c.query("select set_config('app.user_id', $1, true)", [b.id]);
      await expect(
        c.query("insert into public.kill_switch (user_id, enabled) values ($1, true) on conflict (user_id) do update set enabled = true", [a.id]),
      ).rejects.toThrow();
      await c.query("rollback");
      // The server role cannot read the mock bank schema.
      await expect(c.query("select count(*) from mockbank.payments")).rejects.toThrow(/permission denied/);
    } finally {
      c.release();
    }
  });

  it("mock bank: rejects bad API keys, replays idempotent payments and logs calls", async () => {
    const u = await createTestUser(admin, [{ biller: "CHINA_MOBILE", amount: 98, key: "mobile" }]);
    const key = `test:${randomUUID()}`;
    const req = (apiKey: string) =>
      new Request("http://local/mockbank/payments", {
        method: "POST",
        headers: { "x-api-key": apiKey, "x-customer-id": u.id, "content-type": "application/json" },
        body: JSON.stringify({ bill_id: u.bills.mobile, biller_id: "CHINA_MOBILE", amount: 98, idempotency_key: key }),
      });
    expect((await inProcessTransport(req("wrong"))).status).toBe(401);
    const r1 = await inProcessTransport(req(process.env.MOCKBANK_API_KEY!));
    const r2 = await inProcessTransport(req(process.env.MOCKBANK_API_KEY!));
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    const [b1, b2] = [await r1.json(), await r2.json()];
    expect(b2.payment_id).toBe(b1.payment_id);
    expect(b2.replayed).toBe(true);
    expect(await payments(u.bills.mobile)).toHaveLength(1);

    const ev = await inProcessTransport(
      new Request("http://local/mockbank/events?since=0", { headers: { "x-api-key": process.env.MOCKBANK_API_KEY!, "x-customer-id": u.id } }),
    );
    const { events } = await ev.json();
    expect(events.some((e: { type: string }) => e.type === "payment.succeeded")).toBe(true);
    const log = await admin.query("select count(*)::int as n from mockbank.call_log where path = '/payments' and request_json->>'idempotency_key' = $1", [key]);
    expect(log.rows[0].n).toBe(2);
  });
});
