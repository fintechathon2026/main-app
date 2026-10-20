// Owner: R3 (roles.md).
// /api/cron/chain-sync and /api/admin/run-now auth and dispatch, with the job functions mocked.
// No database needed.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as S from "./api-schemas";

vi.mock("next/server", () => ({ connection: async () => {} }));

const jobs = vi.hoisted(() => ({
  runFxJob: vi.fn(),
  runDetectJob: vi.fn(),
  runCleanupJob: vi.fn(),
  runRiskJob: vi.fn(),
  runChainSyncJob: vi.fn(),
}));
vi.mock("@/src/server/cron/jobs", async () => {
  const { ChainSyncNotImplementedError } = await import("@/src/server/cron/chain-sync");
  return { ...jobs, ChainSyncNotImplementedError, cronUserIds: vi.fn() };
});

const { ChainSyncNotImplementedError } = await import("@/src/server/cron/chain-sync");
const chainSync = await import("@/app/api/cron/chain-sync/route");
const { POST: runNow } = await import("@/app/api/admin/run-now/route");

const SECRET = "cron-secret-for-tests";
const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const cronReq = (auth?: string, method = "GET") =>
  new Request("http://localhost/api/cron/chain-sync", { method, headers: auth ? { authorization: auth } : {} });
const runReq = (user: string | null, body: unknown) =>
  new Request("http://localhost/api/admin/run-now", {
    method: "POST",
    headers: { ...(user ? { "x-demo-user": user } : {}), "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", SECRET);
  vi.stubEnv("REINS_DEMO_AUTH", "1");
  vi.stubEnv("REINS_FIXTURES", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
  vi.stubEnv("REINS_ADMIN_USER_IDS", ` ${ADMIN.toUpperCase()} , ${"c".repeat(8)}-cccc-4ccc-8ccc-cccccccccccc`);
  for (const f of Object.values(jobs)) f.mockReset();
  jobs.runFxJob.mockResolvedValue([{ base: "USD" }, { base: "IDR" }]);
  jobs.runDetectJob.mockImplementation(async (ids: string[]) => ids.map((userId) => ({ userId })));
  jobs.runCleanupJob.mockImplementation(async (ids: string[]) => ids.map((userId) => ({ userId, closedPlans: 0 })));
  jobs.runRiskJob.mockResolvedValue({ errors: [], plans: { started: [] } });
  jobs.runChainSyncJob.mockResolvedValue({ mode: "mock", skipped: true });
});
afterEach(() => vi.unstubAllEnvs());

describe("/api/cron/chain-sync", () => {
  it("rejects a missing or wrong secret without running the job", async () => {
    for (const auth of [undefined, "Bearer wrong", `Bearer ${SECRET}x`, SECRET, `Basic ${SECRET}`]) {
      expect((await chainSync.GET(cronReq(auth))).status).toBe(401);
      expect((await chainSync.POST(cronReq(auth, "POST"))).status).toBe(401);
    }
    vi.stubEnv("CRON_SECRET", "");
    expect((await chainSync.GET(cronReq("Bearer "))).status).toBe(401);
    expect(jobs.runChainSyncJob).not.toHaveBeenCalled();
  });

  it("returns a skipped no-op in mock mode", async () => {
    const res = await chainSync.GET(cronReq(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true, mode: "mock", skipped: true });
  });

  it("answers 501 in chain mode", async () => {
    jobs.runChainSyncJob.mockRejectedValueOnce(new ChainSyncNotImplementedError());
    const res = await chainSync.POST(cronReq(`Bearer ${SECRET}`, "POST"));
    expect(res.status).toBe(501);
    expect(await res.json()).toEqual({ error: "chain_sync_not_implemented" });
  });

  it("maps any other failure to 500 without details", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    jobs.runChainSyncJob.mockRejectedValueOnce(new Error("db password is hunter2"));
    const res = await chainSync.GET(cronReq(`Bearer ${SECRET}`));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("hunter2");
  });
});

describe("/api/admin/run-now", () => {
  const noJobRan = () => {
    for (const f of Object.values(jobs)) expect(f).not.toHaveBeenCalled();
  };

  it("requires a session", async () => {
    expect((await runNow(runReq(null, { job: "fx" }))).status).toBe(401);
    noJobRan();
  });

  it("forbids non-admins, and everyone when REINS_ADMIN_USER_IDS is unset", async () => {
    expect((await runNow(runReq(OTHER, { job: "fx" }))).status).toBe(403);
    vi.stubEnv("REINS_ADMIN_USER_IDS", "");
    expect((await runNow(runReq(ADMIN, { job: "fx" }))).status).toBe(403);
    noJobRan();
  });

  it("rejects an unknown job or a bad body", async () => {
    for (const body of [{ job: "drop-tables" }, { job: "cleanup", userId: OTHER }, {}, "{not json"]) {
      const res = await runNow(runReq(ADMIN, body));
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    noJobRan();
  });

  it("cleanup and detect run only for the signed-in admin", async () => {
    const res = await runNow(runReq(ADMIN, { job: "cleanup" }));
    expect(res.status).toBe(200);
    expect(S.RunNowResponse.parse(await res.json())).toMatchObject({ job: "cleanup", ok: true, scope: "user", stats: { users: 1, failed: 0 } });
    expect(jobs.runCleanupJob).toHaveBeenCalledExactlyOnceWith([ADMIN]);

    await runNow(runReq(ADMIN, { job: "detect" }));
    expect(jobs.runDetectJob).toHaveBeenCalledExactlyOnceWith([ADMIN]);
  });

  it("risk runs with onlyUserId; a job error makes ok false", async () => {
    jobs.runRiskJob.mockResolvedValueOnce({ errors: [{ step: "registry", message: "down" }], plans: { started: [] } });
    const res = await runNow(runReq(ADMIN, { job: "risk" }));
    expect(S.RunNowResponse.parse(await res.json())).toMatchObject({ job: "risk", ok: false, scope: "user" });
    expect(jobs.runRiskJob).toHaveBeenCalledExactlyOnceWith({ onlyUserId: ADMIN });
  });

  it("fx and chain-sync are global", async () => {
    const fx = S.RunNowResponse.parse(await (await runNow(runReq(ADMIN, { job: "fx" }))).json());
    expect(fx).toMatchObject({ job: "fx", ok: true, scope: "global", stats: { stored: 2 } });
    expect(jobs.runFxJob).toHaveBeenCalledExactlyOnceWith();
    const cs = S.RunNowResponse.parse(await (await runNow(runReq(ADMIN, { job: "chain-sync" }))).json());
    expect(cs).toMatchObject({ job: "chain-sync", scope: "global", stats: { mode: "mock", skipped: true } });
  });

  it("chain-sync in chain mode answers 501; other job errors 500 without details", async () => {
    jobs.runChainSyncJob.mockRejectedValueOnce(new ChainSyncNotImplementedError());
    expect((await runNow(runReq(ADMIN, { job: "chain-sync" }))).status).toBe(501);
    vi.spyOn(console, "error").mockImplementation(() => {});
    jobs.runCleanupJob.mockRejectedValueOnce(new Error("db password is hunter2"));
    const res = await runNow(runReq(ADMIN, { job: "cleanup" }));
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toContain("job_failed");
    expect(text).not.toContain("hunter2");
  });
});
