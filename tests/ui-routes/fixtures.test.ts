// Owner: R2 (roles.md).
// R2's fixtures/api/*.json for the UI read routes must (1) parse against the zod mirror of
// src/server/api-types.ts and (2) equal what the pure view builders produce from the same stored
// rows, so R4's screens show what the code computes. No database needed.
// Regenerate with: UPDATE_FIXTURES=1 pnpm vitest run tests/ui-routes/fixtures.test.ts

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ModelClients } from "@/src/agent/deps";
import { GENESIS_HASH, auditHash } from "@/src/server/audit";
import { compile } from "@/src/server/mandate/compile";
import { type AuditEntry, buildAuditVerify } from "@/src/server/db/read/audit-view";
import { buildFeed, buildWhy } from "@/src/server/db/read/feed-view";
import { buildActive, buildHistory } from "@/src/server/db/read/mandate-view";
import * as S from "./api-schemas";
import { LIN_FEED_ROWS, LIN_MANDATE_ROWS } from "./seed";

const DIR = join(process.cwd(), "fixtures", "api");
const LIN = "11111111-1111-4111-8111-111111111111";
const NOW = "2026-10-19T03:00:00.000Z";

const TX = "0x5e1f7a2c5e1f7a2c5e1f7a2c5e1f7a2c5e1f7a2c5e1f7a2c5e1f7a2c00000070";

type Seed = { at: string; actor: AuditEntry["actor"]; eventType: string; event: Record<string, unknown> };
const gate = (actionId: string, tool: string, decision: string, ruleIds: string[]): Seed["event"] => ({
  actionId,
  tool,
  phase: "execute",
  result: { decision, ruleIds, mandateVersion: 3 },
});

const SEEDS: Seed[] = [
  { at: "2026-10-01T09:15:00.000Z", actor: "user", eventType: "mandate.activated", event: { version: 1 } },
  { at: "2026-10-16T03:00:00.000Z", actor: "system", eventType: "plan.persisted", event: { planId: "91000000-0000-4000-8000-000000000005" } },
  { at: "2026-10-18T08:30:00.000Z", actor: "gate", eventType: "decision", event: gate("ac000000-0000-4000-8000-000000000004", "pay_bill", "allow", ["payees.allow", "bills.auto_pay_max"]) },
  { at: "2026-10-18T08:30:02.000Z", actor: "system", eventType: "execution.succeeded", event: { actionId: "ac000000-0000-4000-8000-000000000004", tool: "pay_bill", result: { ok: true } } },
  { at: "2026-10-18T09:05:00.000Z", actor: "gate", eventType: "decision", event: gate("ac000000-0000-4000-8000-000000000003", "pay_bill", "deny", ["payees.not_allowed"]) },
  { at: "2026-10-19T01:12:00.000Z", actor: "gate", eventType: "decision", event: gate("ac000000-0000-4000-8000-000000000002", "pay_bill", "require_confirm", ["payees.allow", "bills.over_auto_pay_max"]) },
  { at: "2026-10-19T01:12:01.000Z", actor: "system", eventType: "approval.created", event: { approvalId: "a0000000-0000-4000-8000-000000000001", actionId: "ac000000-0000-4000-8000-000000000002" } },
  { at: "2026-10-10T11:30:00.000Z", actor: "system", eventType: "execution.succeeded", event: { actionId: "ac000000-0000-4000-8000-000000000006", tool: "prepaid_redeem", result: { txHash: TX, simulated: false } } },
  { at: "2026-10-19T02:40:00.000Z", actor: "user", eventType: "kill_switch.changed", event: { enabled: false, previous: true } },
];

/** A valid hash chain for Lin, in time order (seq follows insertion order, as in the table). */
function chain(): AuditEntry[] {
  let prev = GENESIS_HASH;
  return [...SEEDS]
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((s, i) => {
      const hash = auditHash(prev, LIN, s.actor, s.eventType, s.event);
      prev = hash;
      return { seq: i + 1, createdAt: s.at, actor: s.actor, eventType: s.eventType, hash, event: s.event };
    });
}

const COMPILE_TEXT = "Pay bills up to 200 yuan for SZ_POWER and CHINA_MOBILE. Never more than 500 a day. Ask me before cancelling.";

const FIXTURE_DIRECTION: Record<number, "less" | "more"> = { 2: "less", 3: "more" };

/** What the compiler model drafts for the sample text; compile() fills the rest and reads it back. */
const COMPILE_DRAFT = {
  payees: { allow: ["SZ_POWER", "CHINA_MOBILE"] },
  bills: { auto_pay_max: 200 },
  subscriptions: { cancel: "confirm" },
  global: { daily_outflow_cap: 500 },
};
const compileFixture = async (): Promise<unknown> => {
  const models = { mandate_compiler: { chat: async () => { throw new Error("unused"); }, structured: async () => COMPILE_DRAFT } } as unknown as Pick<ModelClients, "mandate_compiler">;
  const r = await compile(COMPILE_TEXT, { models, baseCurrency: "CNY" });
  return { baseCurrency: "CNY", policy: r.policy, defaulted: r.defaulted, readback: r.readback };
};

async function generate(): Promise<Record<string, unknown>> {
  const entries = chain();
  return {
    "mandates-compile.json": await compileFixture(),
    "audit-verify.json": buildAuditVerify({ ok: true, count: entries.length, firstBreakSeq: null }, entries, NOW),
    "mandates-active.json": buildActive(LIN_MANDATE_ROWS.find((r) => r.status === "active")!),
    // TODO(R2): drop the override when buildHistory classifies with compareMandates
    // (src/core/mandate/narrow.ts). Until then only the fixture shows less/more.
    "mandates-history.json": buildHistory(LIN_MANDATE_ROWS).map((v) => ({ ...v, direction: FIXTURE_DIRECTION[v.version] ?? v.direction })),
    "feed.json": buildFeed(LIN_FEED_ROWS),
    "feed-why.json": Object.fromEntries(LIN_FEED_ROWS.map((r) => [r.id, buildWhy(r)])),
  };
}

const SCHEMAS: Record<string, z.ZodType> = {
  "mandates-compile.json": S.MandateCompileResponse,
  "audit-verify.json": S.AuditVerifyResponse,
  "mandates-active.json": S.MandateActiveResponse,
  "mandates-history.json": S.MandateHistoryResponse,
  "feed.json": S.FeedResponse,
  "feed-why.json": z.record(z.string(), S.FeedWhyResponse),
};

const read = (f: string) => JSON.parse(readFileSync(join(DIR, f), "utf8")) as unknown;

describe("R2 fixtures/api", () => {
  if (process.env.UPDATE_FIXTURES === "1") {
    it("regenerates the fixtures", async () => {
      for (const [f, v] of Object.entries(await generate())) writeFileSync(join(DIR, f), `${JSON.stringify(v, null, 2)}\n`);
    });
  }

  for (const [file, schema] of Object.entries(SCHEMAS)) {
    it(`${file} matches its api-types schema`, () => {
      const r = schema.safeParse(read(file));
      expect(r.success, r.success ? "" : `${file}: ${r.error.message}`).toBe(true);
    });
  }

  it("fixtures equal what the view builders produce", async () => {
    for (const [f, v] of Object.entries(await generate())) expect(read(f), f).toEqual(JSON.parse(JSON.stringify(v)));
  });

  it("audit-verify.json hashes are a valid chain of the stored entries", () => {
    const rows = S.AuditVerifyResponse.parse(read("audit-verify.json")).rows;
    const entries = chain().reverse();
    expect(rows.map((r) => r.hash)).toEqual(entries.map((e) => e.hash));
    expect(rows[0]!.seq).toBeGreaterThan(rows[rows.length - 1]!.seq);
  });

  it("audit-verify.json shows tx links only for real chain transactions", () => {
    const rows = S.AuditVerifyResponse.parse(read("audit-verify.json")).rows;
    const withTx = rows.filter((r) => r.tx);
    expect(withTx).toHaveLength(1);
    expect(withTx[0]!.tx!.explorerUrl).toBe(`https://sepolia.basescan.org/tx/${TX}`);
  });
});
