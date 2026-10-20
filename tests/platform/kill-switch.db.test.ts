// Owner: R3 (roles.md).
// GET|POST /api/kill-switch against Postgres: session-scoped, audited, and the Gate denies every
// action while the switch is on. Skipped without DATABASE_URL.

import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getMockbankPool, setMockbankPool } from "@/src/mockbank/db";
import { verifyAuditChain } from "@/src/server/audit";
import { getPool, setPool } from "@/src/server/db/pool";
import { createExecutor } from "@/src/server/executor";
import { PgPlanStore } from "@/src/server/plan-store";
import { DB_ENABLED, adminPool, createTestUser, inProcessTransport, planPayments } from "../foundations/helpers";
import * as S from "./api-schemas";

vi.mock("next/server", () => ({ connection: async () => {} }));

const { GET, POST } = await import("@/app/api/kill-switch/route");

const req = (user: string | null, body?: unknown, raw?: string) =>
  new Request("http://localhost/api/kill-switch", {
    method: body === undefined && raw === undefined ? "GET" : "POST",
    headers: { ...(user ? { "x-demo-user": user } : {}), "content-type": "application/json" },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });

describe.skipIf(!DB_ENABLED)("platform: kill switch route", () => {
  let admin: Pool;
  const executor = createExecutor({ transport: inProcessTransport });
  const store = new PgPlanStore(executor);

  beforeAll(() => {
    process.env.MOCKBANK_API_KEY ??= "test-mockbank-key";
    admin = adminPool();
  });
  beforeEach(() => {
    vi.stubEnv("REINS_DEMO_AUTH", "1");
    vi.stubEnv("REINS_FIXTURES", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await admin.end();
    await getPool().end();
    setPool(null);
    await getMockbankPool().end();
    setMockbankPool(null);
  });

  const row = async (userId: string) => (await admin.query("select enabled from public.kill_switch where user_id = $1", [userId])).rows[0]?.enabled;
  const auditRows = async (userId: string) =>
    (await admin.query("select actor, event_type, event_json from public.audit_log where user_id = $1 order by seq", [userId])).rows;

  it("requires a session", async () => {
    expect((await GET(req(null))).status).toBe(401);
    expect((await POST(req(null, { enabled: true }))).status).toBe(401);
  });

  it("rejects a bad body without changing anything", async () => {
    const u = await createTestUser(admin, []);
    for (const r of [req(u.id, undefined, "{not json"), req(u.id, { enabled: "yes" }), req(u.id, { enabled: true, userId: u.id }), req(u.id, {})]) {
      const res = await POST(r);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: "bad_request" });
    }
    expect(await row(u.id)).toBe(false);
    expect(await auditRows(u.id)).toHaveLength(0);
  });

  it("switching on is stored, audited, and makes the Gate deny a planned payment; switching off re-enables", async () => {
    const u = await createTestUser(admin, [{ biller: "CHINA_MOBILE", amount: 98, key: "mobile" }]);
    expect(S.KillSwitchResponse.parse(await (await GET(req(u.id))).json())).toMatchObject({ enabled: false });

    const on = await POST(req(u.id, { enabled: true }));
    expect(on.status).toBe(200);
    expect(S.KillSwitchResponse.parse(await on.json())).toMatchObject({ enabled: true });
    expect(await row(u.id)).toBe(true);
    expect(await auditRows(u.id)).toEqual([
      { actor: "user", event_type: "kill_switch.changed", event_json: { enabled: true, previous: false } },
    ]);
    expect((await verifyAuditChain(u.id)).ok).toBe(true);
    expect(await (await GET(req(u.id))).json()).toMatchObject({ enabled: true });

    const { ids } = await planPayments(store, u.id, [{ billId: u.bills.mobile, billerId: "CHINA_MOBILE", amount: 98 }]);
    const denied = await executor.run(ids[0], u.id);
    expect(denied.status).toBe("denied");
    expect(denied.gate?.ruleIds).toEqual(["global.kill_switch"]);
    expect((await admin.query("select 1 from mockbank.payments where bill_id = $1", [u.bills.mobile])).rowCount).toBe(0);

    const off = await POST(req(u.id, { enabled: false }));
    expect(await off.json()).toMatchObject({ enabled: false });
    expect(await row(u.id)).toBe(false);
    const audit = await auditRows(u.id);
    expect(audit.filter((a) => a.event_type === "kill_switch.changed").map((a) => a.event_json)).toEqual([
      { enabled: true, previous: false },
      { enabled: false, previous: true },
    ]);
    expect((await verifyAuditChain(u.id)).ok).toBe(true);

    const { ids: again } = await planPayments(store, u.id, [{ billId: u.bills.mobile, billerId: "CHINA_MOBILE", amount: 98 }]);
    expect((await executor.run(again[0], u.id)).status).toBe("succeeded");
  });

  it("one user's switch never touches another user's", async () => {
    const a = await createTestUser(admin, []);
    const b = await createTestUser(admin, []);
    await POST(req(a.id, { enabled: true }));
    expect(await row(a.id)).toBe(true);
    expect(await row(b.id)).toBe(false);
    expect(await (await GET(req(b.id))).json()).toMatchObject({ enabled: false });
    expect(await auditRows(b.id)).toHaveLength(0);
  });
});
