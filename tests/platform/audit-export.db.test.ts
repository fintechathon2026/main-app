// Owner: R3 (roles.md).
// GET /api/audit/export against Postgres: the user's own chain only, re-verifiable offline, JSONL
// and CSV. Skipped without DATABASE_URL (except the fixture-mode case, which needs no DB).

import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { appendAudit, auditHash, GENESIS_HASH } from "@/src/server/audit";
import { getPool, setPool, withUserTx } from "@/src/server/db/pool";
import { DB_ENABLED, adminPool, createTestUser } from "../foundations/helpers";
import * as S from "./api-schemas";

vi.mock("next/server", () => ({ connection: async () => {} }));

const { GET } = await import("@/app/api/audit/export/route");

const get = (user: string | null, query = "") =>
  GET(new Request(`http://localhost/api/audit/export${query}`, { headers: user ? { "x-demo-user": user } : {} }));

/** Minimal RFC 4180 parser (quoted cells, doubled quotes, CRLF rows). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\r" && text[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
    } else cell += c;
  }
  return rows;
}

beforeEach(() => {
  vi.stubEnv("REINS_DEMO_AUTH", "1");
  vi.stubEnv("REINS_FIXTURES", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("platform: audit export (fixture mode)", () => {
  it("serves the fixture as JSONL without a session", async () => {
    vi.stubEnv("REINS_FIXTURES", "1");
    const res = await get(null);
    expect(res.status).toBe(200);
    const lines = (await res.text()).trimEnd().split("\n").map((l) => S.AuditExportEntry.parse(JSON.parse(l)));
    expect(lines.map((l) => l.seq)).toEqual([1, 2]);
  });
});

describe.skipIf(!DB_ENABLED)("platform: audit export against Postgres", () => {
  let admin: Pool;

  beforeAll(() => {
    admin = adminPool();
  });
  afterAll(async () => {
    await admin.end();
    await getPool().end();
    setPool(null);
  });

  const tricky = { note: 'a, "quoted"\nsecond line', amount: 98 };

  async function seed() {
    const a = await createTestUser(admin, []);
    const b = await createTestUser(admin, []);
    await withUserTx(a.id, async (tx) => {
      await appendAudit(tx, a.id, { actor: "user", eventType: "kill_switch.changed", data: { enabled: true, previous: false } });
      await appendAudit(tx, a.id, { actor: "gate", eventType: "gate.decision", data: { decision: "deny", ruleIds: ["global.kill_switch"] } });
      await appendAudit(tx, a.id, { actor: "system", eventType: "note", data: tricky });
    });
    await withUserTx(b.id, (tx) => appendAudit(tx, b.id, { actor: "user", eventType: "b.only.event", data: { secret: "b-secret" } }));
    return { a, b };
  }

  it("requires a session and a known format", async () => {
    const { a } = await seed();
    expect((await get(null)).status).toBe(401);
    expect((await get(null, "?format=csv")).status).toBe(401);
    const bad = await get(a.id, "?format=xml");
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ code: "bad_format" });
  });

  it("JSONL: one entry per line, seq ascending, a chain that re-verifies, only the user's own entries", async () => {
    const { a } = await seed();
    const res = await get(a.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/x-ndjson; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe("attachment; filename=reins-audit.jsonl");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const text = await res.text();
    expect(text.endsWith("\n")).toBe(true);
    const entries = text.trimEnd().split("\n").map((l) => S.AuditExportEntry.parse(JSON.parse(l)));
    expect(entries.map((e) => e.eventType)).toEqual(["kill_switch.changed", "gate.decision", "note"]);
    let prev = GENESIS_HASH;
    let prevSeq = 0;
    for (const e of entries) {
      expect(e.seq).toBeGreaterThan(prevSeq);
      expect(e.prevHash).toBe(prev);
      expect(auditHash(e.prevHash, a.id, e.actor, e.eventType, e.event)).toBe(e.hash);
      prev = e.hash;
      prevSeq = e.seq;
    }
    expect(entries[2].event).toEqual(tricky);
    expect(text).not.toContain("b.only.event");
    expect(text).not.toContain("b-secret");
  });

  it("CSV: header row plus one row per entry, awkward values quoted", async () => {
    const { a, b } = await seed();
    const res = await get(a.id, "?format=csv");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe("attachment; filename=reins-audit.csv");
    const text = await res.text();
    const rows = parseCsv(text);
    expect(rows[0]).toEqual(["seq", "createdAt", "actor", "eventType", "prevHash", "hash", "event"]);
    expect(rows).toHaveLength(4);
    expect(rows.slice(1).map((r) => r[3])).toEqual(["kill_switch.changed", "gate.decision", "note"]);
    expect(rows[1][4]).toBe(GENESIS_HASH);
    expect(JSON.parse(rows[3][6])).toEqual(tricky);
    // The event cell has commas and quotes, so it is quoted with doubled quotes.
    expect(text).toContain(`"${JSON.stringify(tricky).replace(/"/g, '""')}"`);
    expect(text).not.toContain("b-secret");

    const other = parseCsv(await (await get(b.id, "?format=csv")).text());
    expect(other).toHaveLength(2);
    expect(other[1][3]).toBe("b.only.event");
  });
});
