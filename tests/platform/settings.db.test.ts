// Owner: R3 (roles.md).
// GET|PATCH /api/settings against Postgres: session-scoped, strict body, audited without PII,
// base currency read-only. Skipped without DATABASE_URL.

import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyAuditChain } from "@/src/server/audit";
import { getPool, setPool } from "@/src/server/db/pool";
import { DB_ENABLED, adminPool, createTestUser } from "../foundations/helpers";
import * as S from "./api-schemas";

vi.mock("next/server", () => ({ connection: async () => {} }));

const { GET, PATCH } = await import("@/app/api/settings/route");

const get = (user: string | null) => GET(new Request("http://localhost/api/settings", { headers: user ? { "x-demo-user": user } : {} }));
const patch = (user: string | null, body: unknown) =>
  PATCH(
    new Request("http://localhost/api/settings", {
      method: "PATCH",
      headers: { ...(user ? { "x-demo-user": user } : {}), "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

describe.skipIf(!DB_ENABLED)("platform: settings routes", () => {
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

  const userRow = async (id: string) =>
    (await admin.query("select display_name, locale, timezone, base_currency from public.users where id = $1", [id])).rows[0];
  const auditRows = async (id: string) =>
    (await admin.query("select actor, event_type, event_json from public.audit_log where user_id = $1 order by seq", [id])).rows;

  it("requires a session", async () => {
    expect((await get(null)).status).toBe(401);
    expect((await patch(null, { displayName: "X" })).status).toBe(401);
  });

  it("GET returns the user's own profile, kill switch, mandate version and data sources", async () => {
    const u = await createTestUser(admin, []);
    const ds = await admin.query("insert into public.data_sources (user_id, type) values ($1, 'mock_bank') returning id", [u.id]);
    const res = await get(u.id);
    expect(res.status).toBe(200);
    const body = S.SettingsResponse.parse(await res.json());
    expect(body).toMatchObject({
      profile: { email: `test-${u.id}@test.reins.local`, displayName: null, locale: "zh-CN", timezone: "Asia/Shanghai", baseCurrency: "CNY" },
      killSwitch: { enabled: false },
      mandateVersion: 3,
      dataSources: [{ id: ds.rows[0].id, type: "mock_bank", status: "active", lastSyncedAt: null }],
    });
  });

  it("PATCH persists valid fields and audits field names only", async () => {
    const u = await createTestUser(admin, []);
    const res = await patch(u.id, { displayName: "  Lin Test  ", locale: "en-US", timezone: "Asia/Jakarta" });
    expect(res.status).toBe(200);
    const body = S.SettingsResponse.parse(await res.json());
    expect(body.profile).toMatchObject({ displayName: "Lin Test", locale: "en-US", timezone: "Asia/Jakarta", baseCurrency: "CNY" });
    expect(await userRow(u.id)).toEqual({ display_name: "Lin Test", locale: "en-US", timezone: "Asia/Jakarta", base_currency: "CNY" });
    const audit = await auditRows(u.id);
    expect(audit).toEqual([{ actor: "user", event_type: "settings.changed", event_json: { fields: ["displayName", "locale", "timezone"] } }]);
    expect(JSON.stringify(audit)).not.toContain("Lin Test");
    expect((await verifyAuditChain(u.id)).ok).toBe(true);
  });

  it("rejects baseCurrency, unknown keys and invalid values without changing anything", async () => {
    const u = await createTestUser(admin, []);
    const before = await userRow(u.id);
    for (const body of [
      { baseCurrency: "IDR" },
      { displayName: "Ok", baseCurrency: "IDR" },
      { email: "x@example.com" },
      { timezone: "Mars/Olympus" },
      { locale: "english" },
      { displayName: "   " },
      { displayName: "x".repeat(81) },
      {},
      "{not json",
    ]) {
      const res = await patch(u.id, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(await res.json()).toMatchObject({ code: "bad_request" });
    }
    expect(await userRow(u.id)).toEqual(before);
    expect(await auditRows(u.id)).toHaveLength(0);
  });

  it("one user cannot read or change another user's settings", async () => {
    const a = await createTestUser(admin, []);
    const b = await createTestUser(admin, []);
    await patch(a.id, { displayName: "Alice" });
    const bView = S.SettingsResponse.parse(await (await get(b.id)).json());
    expect(bView.profile.email).toBe(`test-${b.id}@test.reins.local`);
    expect(bView.profile.displayName).toBeNull();
    expect((await userRow(b.id)).display_name).toBeNull();
    expect(await auditRows(b.id)).toHaveLength(0);
  });
});
