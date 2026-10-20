// Owner: R2 (roles.md).
// Route-level tests for the UI read routes, with the repositories mocked. Fixture mode needs no
// database and no session; the session path checks that the user comes from the session and the
// repository is called with it. No database needed.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as S from "./api-schemas";

vi.mock("next/server", () => ({ connection: async () => {} }));

const repo = vi.hoisted(() => ({ loadAuditVerify: vi.fn() }));
vi.mock("@/src/server/db/read/audit-repo", () => repo);

const LIN = "11111111-1111-4111-8111-111111111111";
const get = (path: string, user?: string) =>
  new Request(`http://localhost${path}`, { headers: user ? { "x-demo-user": user } : {} });

beforeEach(() => {
  vi.stubEnv("REINS_FIXTURES", "1");
  vi.stubEnv("REINS_DEMO_AUTH", "1");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
  for (const f of Object.values(repo)) f.mockReset();
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
