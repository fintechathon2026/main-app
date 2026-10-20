// Owner: R3 (roles.md).
// Run-now, chain-sync and cron user resolution against Postgres. Skipped without DATABASE_URL.
//
// cron/detect is exercised with the real route, jobs module, cron_user_ids() and job_runs
// bookkeeping; only the per-user detection step is stubbed, because cron_user_ids() returns every
// user with an active mandate (all test users ever created, plus Lin's seed, which other suites
// read in parallel). Real detection is covered by tests/read.

import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { pgPlanRegistry } from "@/src/agent/run";
import { getPool, setPool } from "@/src/server/db/pool";
import { DB_ENABLED, adminPool, createTestUser } from "../foundations/helpers";
import * as S from "./api-schemas";

vi.mock("next/server", () => ({ connection: async () => {} }));

const detect = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("@/src/server/db/read/detect-job", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/server/db/read/detect-job")>();
  return {
    ...actual,
    runDetectForUser: async (userId: string) => {
      detect.calls.push(userId);
      return { userId, inserted: 0, updated: 0, recommendations: 0 };
    },
  };
});

const { POST: runNow } = await import("@/app/api/admin/run-now/route");
const { GET: cronDetect } = await import("@/app/api/cron/detect/route");
const chainSync = await import("@/app/api/cron/chain-sync/route");

const SECRET = "run-now-cron-secret-for-tests";

describe.skipIf(!DB_ENABLED)("platform: run-now and cron users against Postgres", () => {
  let admin: Pool;

  beforeAll(() => {
    admin = adminPool();
  });
  beforeEach(() => {
    vi.stubEnv("REINS_DEMO_AUTH", "1");
    vi.stubEnv("REINS_FIXTURES", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    vi.stubEnv("CRON_SECRET", SECRET);
    vi.stubEnv("REINS_ESCROW", "");
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await admin.end();
    await getPool().end();
    setPool(null);
  });

  /** A paused due_date plan whose only approval expired a minute ago (as in tests/harness/plans.db.test.ts). */
  async function expiredPausedPlan(userId: string, subjectId: string) {
    const planId = await pgPlanRegistry.create({ userId, trigger: "due_date", subjectId });
    await pgPlanRegistry.setStatus(planId, userId, "paused");
    const a = await admin.query(
      `insert into public.actions (plan_id, user_id, idx, tool, args_json, args_hash, mandate_version, idempotency_key, status)
       values ($1, $2, 0, 'pay_bill', '{}', repeat('a', 64), 3, gen_random_uuid()::text, 'awaiting_approval') returning id`,
      [planId, userId],
    );
    await admin.query(
      `insert into public.approvals (user_id, action_id, action_hash, mandate_version, expires_at)
       values ($1, $2, repeat('a', 64), 3, now() - interval '1 minute')`,
      [userId, a.rows[0].id],
    );
    return planId;
  }
  const planStatus = async (id: string) => (await admin.query("select status from public.plans where id = $1", [id])).rows[0].status;
  const dbNow = async () => (await admin.query("select now() as t")).rows[0].t as Date;
  const jobRuns = async (job: string, since: Date) =>
    (await admin.query("select status, stats_json from public.job_runs where job = $1 and started_at >= $2 order by started_at", [job, since])).rows;

  const runReq = (user: string, job: string) =>
    new Request("http://localhost/api/admin/run-now", {
      method: "POST",
      headers: { "x-demo-user": user, "content-type": "application/json" },
      body: JSON.stringify({ job }),
    });

  it("admin cleanup closes only the admin's own expired paused plan and records a job run", async () => {
    const a = await createTestUser(admin, [{ biller: "SZ_POWER", amount: 200, key: "b" }]);
    const b = await createTestUser(admin, [{ biller: "SZ_POWER", amount: 200, key: "b" }]);
    const planA = await expiredPausedPlan(a.id, a.bills.b);
    const planB = await expiredPausedPlan(b.id, b.bills.b);
    vi.stubEnv("REINS_ADMIN_USER_IDS", a.id);
    vi.stubEnv("REINS_CRON_USER_IDS", `${a.id},${b.id}`); // run-now must ignore the cron list
    const since = await dbNow();

    expect((await runNow(runReq(b.id, "cleanup"))).status).toBe(403);
    expect(await planStatus(planB)).toBe("paused");

    const res = await runNow(runReq(a.id, "cleanup"));
    expect(res.status).toBe(200);
    expect(S.RunNowResponse.parse(await res.json())).toMatchObject({ job: "cleanup", ok: true, scope: "user", stats: { users: 1, failed: 0 } });
    expect(await planStatus(planA)).toBe("done");
    expect(await planStatus(planB)).toBe("paused");
    expect(await jobRuns("cleanup", since)).toContainEqual({ status: "succeeded", stats_json: { users: 1, failed: 0 } });
  });

  it("chain-sync records a skipped run in mock mode and refuses chain mode without a chain env", async () => {
    const since = await dbNow();
    const ok = await chainSync.GET(new Request("http://localhost/api/cron/chain-sync", { headers: { authorization: `Bearer ${SECRET}` } }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, mode: "mock", skipped: true });
    expect(await jobRuns("chain-sync", since)).toContainEqual({ status: "succeeded", stats_json: { mode: "mock", skipped: true } });

    vi.stubEnv("REINS_ESCROW", "chain");
    vi.stubEnv("ESCROW_ADDRESS", ""); // chain mode without a chain env: refuse, never a fake sync
    const before = (await jobRuns("chain-sync", since)).length;
    const no = await chainSync.POST(new Request("http://localhost/api/cron/chain-sync", { method: "POST", headers: { authorization: `Bearer ${SECRET}` } }));
    expect(no.status).toBe(501);
    expect(await no.json()).toEqual({ error: "chain_not_configured" });
    expect(await jobRuns("chain-sync", since)).toHaveLength(before);
  });

  it("cron/detect without REINS_CRON_USER_IDS runs for the users from public.cron_user_ids()", async () => {
    const u = await createTestUser(admin, []);
    const noMandate = await createTestUser(admin, []);
    await admin.query("update public.mandates set status = 'revoked' where user_id = $1", [noMandate.id]);
    vi.stubEnv("REINS_CRON_USER_IDS", "");
    detect.calls = [];

    const res = await cronDetect(new Request("http://localhost/api/cron/detect", { headers: { authorization: `Bearer ${SECRET}` } }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; results: { userId: string }[] };
    expect(body.ok).toBe(true);
    expect(body.results).toContainEqual({ userId: u.id, inserted: 0, updated: 0, recommendations: 0 });
    expect(detect.calls).toContain(u.id);
    expect(detect.calls).not.toContain(noMandate.id);

    // An explicit env list still wins.
    vi.stubEnv("REINS_CRON_USER_IDS", u.id);
    detect.calls = [];
    const only = (await (await cronDetect(new Request("http://localhost/api/cron/detect", { headers: { authorization: `Bearer ${SECRET}` } }))).json()) as {
      results: { userId: string }[];
    };
    expect(only.results.map((r) => r.userId)).toEqual([u.id]);
    expect(detect.calls).toEqual([u.id]);
  });
});
