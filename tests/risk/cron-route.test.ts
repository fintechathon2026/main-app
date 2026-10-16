import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const job = vi.hoisted(() => ({ runRiskJobRecorded: vi.fn() }));
vi.mock("@/src/server/risk", async () => {
  const auth = await import("@/src/server/risk/auth");
  return { cronAuthorized: auth.cronAuthorized, runRiskJobRecorded: job.runRiskJobRecorded };
});

const { GET, POST } = await import("@/app/api/cron/risk/route");

const SECRET = "cron-secret-for-tests";
const req = (auth?: string, method = "GET") =>
  new Request("http://localhost/api/cron/risk", { method, headers: auth ? { authorization: auth } : {} });

const saved = process.env.CRON_SECRET;
beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
  job.runRiskJobRecorded.mockReset();
  job.runRiskJobRecorded.mockResolvedValue({ errors: [], plans: { started: [] } });
});
afterEach(() => {
  process.env.CRON_SECRET = saved;
});

describe("/api/cron/risk", () => {
  it("rejects a missing or wrong secret without running the job", async () => {
    for (const auth of [undefined, "Bearer wrong", `Bearer ${SECRET}x`, `Bearer ${SECRET.slice(0, -1)}`, SECRET, `Basic ${SECRET}`]) {
      expect((await GET(req(auth))).status).toBe(401);
      expect((await POST(req(auth, "POST"))).status).toBe(401);
    }
    expect(job.runRiskJobRecorded).not.toHaveBeenCalled();
  });

  it("rejects everything when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    expect((await GET(req("Bearer "))).status).toBe(401);
    expect((await GET(req("Bearer undefined"))).status).toBe(401);
    expect(job.runRiskJobRecorded).not.toHaveBeenCalled();
  });

  it("runs the job with the right secret", async () => {
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
    expect(job.runRiskJobRecorded).toHaveBeenCalledTimes(1);
  });

  it("maps a job failure to 500 without leaking details", async () => {
    job.runRiskJobRecorded.mockRejectedValueOnce(new Error("db password is hunter2"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(req(`Bearer ${SECRET}`, "POST"));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("hunter2");
  });
});
