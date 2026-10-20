// Owner: R2 (roles.md).
// POST /api/mandates/activate against Postgres: session-scoped, strict body, classification by
// compareMandates, widening only with review, one transaction with an audit entry, serialized per
// user. Every case uses fresh test users (createTestUser: Lin-like mandate v3), so Lin's seeded
// mandate is never touched. Skipped without DATABASE_URL.
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { LIN_MANDATE_V3 } from "@/src/core/mandate/examples";
import { verifyAuditChain } from "@/src/server/audit";
import { getPool, setPool } from "@/src/server/db/pool";
import { loadActiveMandate, loadMandateHistory } from "@/src/server/db/read/mandate-repo";
import { DB_ENABLED, adminPool, createTestUser } from "../foundations/helpers";
import * as S from "../ui-routes/api-schemas";
vi.mock("next/server", () => ({ connection: async () => {} }));
const { POST } = await import("@/app/api/mandates/activate/route");

/** Lin's v3 as the compile route would send it back: no version, every field present. */
const { version: _v, ...V3_DRAFT } = LIN_MANDATE_V3;
const withCap = (cap: number) => ({ ...V3_DRAFT, global: { daily_outflow_cap: cap } });
const NARROWER = withCap(500);
const WIDER = withCap(5000);

const post = (user: string | null, body: unknown, contentType = "application/json") =>
  POST(
    new Request("http://localhost/api/mandates/activate", {
      method: "POST",
      headers: { ...(user ? { "x-demo-user": user } : {}), "content-type": contentType },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

describe.skipIf(!DB_ENABLED)("platform: POST /api/mandates/activate", () => {
  let admin: Pool;
  beforeAll(() => {
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
  });

  const mandates = async (id: string) =>
    (await admin.query("select version, status, prev_version, created_via, policy_hash from public.mandates where user_id = $1 order by version", [id])).rows;
  const audit = async (id: string) =>
    (await admin.query("select actor, event_type, event_json from public.audit_log where user_id = $1 order by seq", [id])).rows;

  it("requires a session", async () => {
    const res = await post(null, { policy: NARROWER, createdVia: "nl" });
    expect(res.status).toBe(401);
  });

  it("requires a JSON content type", async () => {
    const u = await createTestUser(admin, []);
    const res = await post(u.id, JSON.stringify({ policy: NARROWER, createdVia: "nl" }), "text/plain");
    expect(res.status).toBe(415);
    expect(await mandates(u.id)).toHaveLength(1);
  });

  it("rejects an invalid body or policy and writes nothing", async () => {
    const u = await createTestUser(admin, []);
    const bad = [
      "not json",
      { policy: NARROWER },
      { policy: NARROWER, createdVia: "agent" },
      { policy: NARROWER, createdVia: "nl", userId: u.id },
      { policy: { ...NARROWER, payees: { allow: ["SZ_POWER"], add_account: "8812" } }, createdVia: "nl" },
      { policy: { ...NARROWER, global: { daily_outflow_cap: -1 } }, createdVia: "nl" },
      { policy: { ...NARROWER, base_currency: "IDR" }, createdVia: "nl" },
      { policy: [], createdVia: "nl" },
    ];
    for (const body of bad) expect((await post(u.id, body)).status, JSON.stringify(body)).toBe(400);
    expect(await mandates(u.id)).toHaveLength(1);
    expect(await audit(u.id)).toEqual([]);
  });

  it("activates a narrowing change at once: supersedes v3, audits it, history says less", async () => {
    const u = await createTestUser(admin, []);
    const res = await post(u.id, { policy: { ...NARROWER, base_currency: "CNY" }, createdVia: "nl" });
    expect(res.status).toBe(201);
    const body = S.MandateActivateResponse.parse(await res.json());
    expect(body).toMatchObject({ version: 4, relation: "narrowing" });

    const rows = await mandates(u.id);
    expect(rows.map((r) => [r.version, r.status, r.prev_version, r.created_via])).toEqual([
      [3, "superseded", null, "template"],
      [4, "active", 3, "nl"],
    ]);
    expect(rows[1].policy_hash).toBe(body.hash);

    // The stored policy is the strict form the Gate and the Mandate Card read.
    const active = await loadActiveMandate(u.id);
    expect(active).toMatchObject({ version: 4, hash: body.hash, createdVia: "nl" });
    expect(active!.policy.global.daily_outflow_cap).toBe(500);
    expect(active!.policy.bills.anomaly.alpha).toBeUndefined();

    expect(await audit(u.id)).toEqual([
      {
        actor: "user",
        event_type: "mandate.activated",
        event_json: { version: 4, hash: body.hash, prevVersion: 3, relation: "narrowing", createdVia: "nl" },
      },
    ]);
    expect((await verifyAuditChain(u.id)).ok).toBe(true);
    expect((await loadMandateHistory(u.id)).map((v) => [v.version, v.direction])).toEqual([
      [4, "less"],
      [3, "first"],
    ]);
  });

  it("refuses a widening change without review (409) and writes nothing", async () => {
    const u = await createTestUser(admin, []);
    for (const confirmWidening of [undefined, false]) {
      const res = await post(u.id, { policy: WIDER, createdVia: "nl", ...(confirmWidening === undefined ? {} : { confirmWidening }) });
      expect(res.status).toBe(409);
      const body = S.MandateActivateConflict.parse(await res.json());
      expect(body).toMatchObject({ code: "widening_needs_review", relation: "widening" });
      expect(body.changes).toEqual([{ path: "global.daily_outflow_cap", direction: "wider" }]);
    }
    // Mixed changes count as widening.
    const mixed = await post(u.id, { policy: { ...WIDER, bills: { ...V3_DRAFT.bills, auto_pay_max: 100 } }, createdVia: "nl" });
    expect(mixed.status).toBe(409);
    expect(await mixed.json()).toMatchObject({ code: "widening_needs_review", relation: "incomparable" });

    expect((await mandates(u.id)).map((r) => [r.version, r.status])).toEqual([[3, "active"]]);
    expect(await audit(u.id)).toEqual([]);
  });

  it("activates a widening change after review; history says more", async () => {
    const u = await createTestUser(admin, []);
    const res = await post(u.id, { policy: WIDER, createdVia: "edit", confirmWidening: true });
    expect(res.status).toBe(201);
    expect(S.MandateActivateResponse.parse(await res.json())).toMatchObject({ version: 4, relation: "widening" });
    expect((await mandates(u.id)).map((r) => [r.version, r.status])).toEqual([
      [3, "superseded"],
      [4, "active"],
    ]);
    expect((await loadMandateHistory(u.id))[0]).toMatchObject({ version: 4, direction: "more", status: "active" });
    expect((await verifyAuditChain(u.id)).ok).toBe(true);
  });

  it("re-signing the same rules is equivalent: activates, history direction is null", async () => {
    const u = await createTestUser(admin, []);
    const res = await post(u.id, { policy: V3_DRAFT, createdVia: "template" });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ version: 4, relation: "equivalent" });
    expect((await loadMandateHistory(u.id))[0]).toMatchObject({ version: 4, direction: null });
  });

  it("serializes concurrent activations: distinct versions, exactly one active row", async () => {
    const u = await createTestUser(admin, []);
    const results = await Promise.all([withCap(700), withCap(600), withCap(500)].map((p) => post(u.id, { policy: p, createdVia: "nl" })));
    const ok = results.filter((r) => r.status === 201);
    expect(results.every((r) => r.status === 201 || r.status === 409)).toBe(true);
    expect(ok.length).toBeGreaterThan(0);
    const rows = await mandates(u.id);
    expect(new Set(rows.map((r) => r.version)).size).toBe(rows.length);
    expect(rows.filter((r) => r.status === "active")).toHaveLength(1);
    expect(rows).toHaveLength(1 + ok.length);
    // Each activation names the version it superseded, so the chain of versions has no fork.
    expect(rows.slice(1).map((r) => r.prev_version)).toEqual(rows.slice(0, -1).map((r) => r.version));
    expect((await verifyAuditChain(u.id)).ok).toBe(true);
  });

  it("only touches the session user's mandates", async () => {
    const a = await createTestUser(admin, []);
    const b = await createTestUser(admin, []);
    const before = await mandates(b.id);
    expect((await post(a.id, { policy: NARROWER, createdVia: "nl" })).status).toBe(201);
    expect(await mandates(b.id)).toEqual(before);
    expect(await audit(b.id)).toEqual([]);
  });
});
