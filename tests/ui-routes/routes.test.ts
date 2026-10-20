// Owner: R2 (roles.md).
// Route-level tests for the UI read routes, with the repositories mocked. Fixture mode needs no
// database and no session; the session path checks that the user comes from the session and the
// repository is called with it. No database needed.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as S from "./api-schemas";

vi.mock("next/server", () => ({ connection: async () => {} }));

const repo = vi.hoisted(() => ({
  loadAuditVerify: vi.fn(),
  loadFeed: vi.fn(),
  loadWhy: vi.fn(),
  loadActiveMandate: vi.fn(),
  loadMandateHistory: vi.fn(),
}));
vi.mock("@/src/server/db/read/mandate-repo", () => ({ loadActiveMandate: repo.loadActiveMandate, loadMandateHistory: repo.loadMandateHistory }));

const compileDeps = vi.hoisted(() => ({ structured: vi.fn(), baseCurrency: vi.fn() }));
vi.mock("@/src/agent/models", async (orig) => ({
  ...(await orig<typeof import("@/src/agent/models")>()),
  createModelClients: () => ({ mandate_compiler: { chat: vi.fn(), structured: compileDeps.structured } }),
}));
vi.mock("@/src/server/db/read/repos", () => ({
  getReadRepos: () => ({ settings: async () => ({ baseCurrency: compileDeps.baseCurrency() }) }),
}));
vi.mock("@/src/server/db/read/audit-repo", () => ({ loadAuditVerify: repo.loadAuditVerify }));
vi.mock("@/src/server/db/read/feed-repo", () => ({ loadFeed: repo.loadFeed, loadWhy: repo.loadWhy }));

const LIN = "11111111-1111-4111-8111-111111111111";
const get = (path: string, user?: string) =>
  new Request(`http://localhost${path}`, { headers: user ? { "x-demo-user": user } : {} });

beforeEach(() => {
  vi.stubEnv("REINS_FIXTURES", "1");
  vi.stubEnv("REINS_DEMO_AUTH", "1");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
  for (const f of Object.values(repo)) f.mockReset();
  compileDeps.structured.mockReset();
  compileDeps.baseCurrency.mockReset().mockReturnValue("CNY");
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/audit/verify", () => {
  it("serves the fixture with no session and no database", async () => {
    const { GET } = await import("@/app/api/audit/verify/route");
    const res = await GET(get("/api/audit/verify"));
    expect(res.status).toBe(200);
    const body = S.AuditVerifyResponse.parse(await res.json());
    expect(body.chainOk).toBe(true);
    expect(repo.loadAuditVerify).not.toHaveBeenCalled();
  });

  it("is 401 without a session when fixtures are off", async () => {
    vi.stubEnv("REINS_FIXTURES", "");
    const { GET } = await import("@/app/api/audit/verify/route");
    expect((await GET(get("/api/audit/verify"))).status).toBe(401);
    expect(repo.loadAuditVerify).not.toHaveBeenCalled();
  });

  it("reads the signed-in user's chain, never a user from the query", async () => {
    vi.stubEnv("REINS_FIXTURES", "");
    const out = { chainOk: false, checkedAt: "2026-10-19T03:00:00.000Z", count: 3, firstBreakSeq: 2, rows: [] };
    repo.loadAuditVerify.mockResolvedValue(out);
    const { GET } = await import("@/app/api/audit/verify/route");
    const res = await GET(get("/api/audit/verify?userId=22222222-2222-4222-8222-222222222222", LIN));
    expect(await res.json()).toEqual(out);
    expect(S.AuditVerifyResponse.safeParse(out).success).toBe(true);
    expect(repo.loadAuditVerify).toHaveBeenCalledWith(LIN, expect.any(String));
  });

  it("answers 500 with a generic error when the chain check throws", async () => {
    vi.stubEnv("REINS_FIXTURES", "");
    repo.loadAuditVerify.mockRejectedValue(new Error("connection refused: secret-host"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("@/app/api/audit/verify/route");
    const res = await GET(get("/api/audit/verify", LIN));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret-host");
  });
});

describe("GET /api/feed", () => {
  it("serves the fixture with no session and no database", async () => {
    const { GET } = await import("@/app/api/feed/route");
    const res = await GET(get("/api/feed"));
    expect(res.status).toBe(200);
    const items = S.FeedResponse.parse(await res.json());
    expect(items.length).toBeGreaterThan(0);
    expect(repo.loadFeed).not.toHaveBeenCalled();
  });

  it("is 401 without a session when fixtures are off", async () => {
    vi.stubEnv("REINS_FIXTURES", "");
    const { GET } = await import("@/app/api/feed/route");
    expect((await GET(get("/api/feed"))).status).toBe(401);
    expect(repo.loadFeed).not.toHaveBeenCalled();
  });

  it("loads the feed for the session user only", async () => {
    vi.stubEnv("REINS_FIXTURES", "");
    repo.loadFeed.mockResolvedValue([]);
    const { GET } = await import("@/app/api/feed/route");
    const res = await GET(get("/api/feed?userId=22222222-2222-4222-8222-222222222222", LIN));
    expect(await res.json()).toEqual([]);
    expect(repo.loadFeed).toHaveBeenCalledWith(LIN);
  });
});

describe("GET /api/feed/:id/why", () => {
  const ID = "ac000000-0000-4000-8000-000000000003";
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;

  it("serves the fixture trace for a known id", async () => {
    const { GET } = await import("@/app/api/feed/[id]/why/route");
    const res = await GET(get(`/api/feed/${ID}/why`), ctx(ID));
    expect(res.status).toBe(200);
    const why = S.FeedWhyResponse.parse(await res.json());
    expect(why).toMatchObject({ id: ID, decision: "deny", status: "blocked" });
    expect(why.checks.some((c) => !c.passed)).toBe(true);
  });

  it("is 404 for an unknown id in fixture mode, including prototype keys", async () => {
    const { GET } = await import("@/app/api/feed/[id]/why/route");
    expect((await GET(get("/api/feed/nope/why"), ctx("nope"))).status).toBe(404);
    expect((await GET(get("/api/feed/constructor/why"), ctx("constructor"))).status).toBe(404);
  });

  it("is 404 for a malformed id and for an action the user does not own", async () => {
    vi.stubEnv("REINS_FIXTURES", "");
    const { GET } = await import("@/app/api/feed/[id]/why/route");
    expect((await GET(get("/api/feed/x/why", LIN), ctx("x"))).status).toBe(404);
    expect(repo.loadWhy).not.toHaveBeenCalled();
    repo.loadWhy.mockResolvedValue(null);
    expect((await GET(get(`/api/feed/${ID}/why`, LIN), ctx(ID))).status).toBe(404);
    expect(repo.loadWhy).toHaveBeenCalledWith(LIN, ID);
  });

  it("is 401 without a session when fixtures are off", async () => {
    vi.stubEnv("REINS_FIXTURES", "");
    const { GET } = await import("@/app/api/feed/[id]/why/route");
    expect((await GET(get(`/api/feed/${ID}/why`), ctx(ID))).status).toBe(401);
  });
});

describe("GET /api/mandates/active and /history", () => {
  it("serve the fixtures with no session and no database", async () => {
    const active = await import("@/app/api/mandates/active/route");
    const history = await import("@/app/api/mandates/history/route");
    const a = S.MandateActiveResponse.parse(await (await active.GET(get("/api/mandates/active"))).json());
    expect(a.version).toBe(3);
    const h = S.MandateHistoryResponse.parse(await (await history.GET(get("/api/mandates/history"))).json());
    expect(h.map((v) => v.version)).toEqual([3, 2, 1]);
    expect(repo.loadActiveMandate).not.toHaveBeenCalled();
    expect(repo.loadMandateHistory).not.toHaveBeenCalled();
  });

  it("are 401 without a session when fixtures are off", async () => {
    vi.stubEnv("REINS_FIXTURES", "");
    const active = await import("@/app/api/mandates/active/route");
    const history = await import("@/app/api/mandates/history/route");
    expect((await active.GET(get("/api/mandates/active"))).status).toBe(401);
    expect((await history.GET(get("/api/mandates/history"))).status).toBe(401);
  });

  it("read the session user's mandates only", async () => {
    vi.stubEnv("REINS_FIXTURES", "");
    repo.loadActiveMandate.mockResolvedValue({ version: 3 });
    repo.loadMandateHistory.mockResolvedValue([]);
    const active = await import("@/app/api/mandates/active/route");
    const history = await import("@/app/api/mandates/history/route");
    const q = "?userId=22222222-2222-4222-8222-222222222222";
    expect((await active.GET(get(`/api/mandates/active${q}`, LIN))).status).toBe(200);
    expect((await history.GET(get(`/api/mandates/history${q}`, LIN))).status).toBe(200);
    expect(repo.loadActiveMandate).toHaveBeenCalledWith(LIN);
    expect(repo.loadMandateHistory).toHaveBeenCalledWith(LIN);
  });

  it("answer 404 when the user has no active mandate and 500 for a tampered one", async () => {
    vi.stubEnv("REINS_FIXTURES", "");
    const active = await import("@/app/api/mandates/active/route");
    repo.loadActiveMandate.mockResolvedValueOnce(null);
    const none = await active.GET(get("/api/mandates/active", LIN));
    expect(none.status).toBe(404);
    expect(await none.json()).toMatchObject({ code: "no_active_mandate" });
    vi.spyOn(console, "error").mockImplementation(() => {});
    repo.loadActiveMandate.mockRejectedValueOnce(new Error("stored mandate hash does not match its policy"));
    const bad = await active.GET(get("/api/mandates/active", LIN));
    expect(bad.status).toBe(500);
    expect(JSON.stringify(await bad.json())).not.toContain("hash");
  });
});

describe("POST /api/mandates/compile", () => {
  const post = (body: unknown, user?: string) =>
    new Request("http://localhost/api/mandates/compile", {
      method: "POST",
      headers: { "content-type": "application/json", ...(user ? { "x-demo-user": user } : {}) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

  it("serves the fixture draft for a valid body, with no session, database or model", async () => {
    const { POST } = await import("@/app/api/mandates/compile/route");
    const res = await POST(post({ text: "pay bills under 200" }));
    expect(res.status).toBe(200);
    const out = S.MandateCompileResponse.parse(await res.json());
    expect(out.readback.length).toBeGreaterThan(0);
    expect(compileDeps.structured).not.toHaveBeenCalled();
  });

  it("rejects a bad body in fixture mode too: extra keys, empty or non-string text, no JSON", async () => {
    const { POST } = await import("@/app/api/mandates/compile/route");
    for (const body of [{ text: "x", userId: LIN }, { text: "" }, { text: 5 }, {}, "not json"]) {
      expect((await POST(post(body))).status, JSON.stringify(body)).toBe(400);
    }
  });

  it("is 401 without a session when fixtures are off, before the body is read", async () => {
    vi.stubEnv("REINS_FIXTURES", "");
    const { POST } = await import("@/app/api/mandates/compile/route");
    expect((await POST(post({ text: "pay bills under 200" }))).status).toBe(401);
    expect(compileDeps.structured).not.toHaveBeenCalled();
  });

  it("compiles for the session user: draft, defaulted fields and a template read-back, nothing saved", async () => {
    vi.stubEnv("REINS_FIXTURES", "");
    compileDeps.structured.mockResolvedValue({ bills: { auto_pay_max: 200 }, global: { daily_outflow_cap: 500 } });
    const { POST } = await import("@/app/api/mandates/compile/route");
    const res = await POST(post({ text: "pay bills under 200, 500 a day at most" }, LIN));
    expect(res.status).toBe(200);
    const out = S.MandateCompileResponse.parse(await res.json());
    expect(out.baseCurrency).toBe("CNY");
    expect(out.policy.bills.auto_pay_max).toBe(200);
    expect(out.policy.payees.new_payee).toBe("deny"); // unmentioned -> most restrictive
    expect(out.defaulted).toContain("payees.new_payee");
    expect(out.readback[0]).toBe("Pay bills automatically up to CNY 200 each; larger or unusual bills need your approval.");
    expect(Object.keys(out).sort()).toEqual(["baseCurrency", "defaulted", "policy", "readback"]);
  });

  it("answers 422 when the model's draft breaks the schema, and for whitespace-only text", async () => {
    vi.stubEnv("REINS_FIXTURES", "");
    const { POST } = await import("@/app/api/mandates/compile/route");
    compileDeps.structured.mockResolvedValue({ payees: { allow: ["SZ_POWER"], add_account: "8812" } });
    const bad = await POST(post({ text: "allow my power company" }, LIN));
    expect(bad.status).toBe(422);
    expect(await bad.json()).toMatchObject({ code: "compile_failed" });
    const blank = await POST(post({ text: "   " }, LIN));
    expect(blank.status).toBe(422);
  });

  it("answers 503 when no recorded model answer exists for the text", async () => {
    vi.stubEnv("REINS_FIXTURES", "");
    const { RecordingMissError } = await import("@/src/agent/models");
    compileDeps.structured.mockRejectedValue(new RecordingMissError("mandate_compiler", "k", "demo_lin"));
    const { POST } = await import("@/app/api/mandates/compile/route");
    const res = await POST(post({ text: "something never recorded" }, LIN));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "model_unavailable" });
  });
});
