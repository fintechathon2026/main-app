import { describe, expect, it } from "vitest";
import { READ_TOOL_NAMES, createReadTools, readTools } from "@/src/agent/tools/read";
import { actionToolSpecs } from "@/src/agent/tools/action-schemas";
import type { ReadTool } from "@/src/agent/tools/types";
import type { Labeled } from "@/src/core/types";
import { LIN, NOW, OFFER, OTHER_USER, SUB, linRecommendationRows, linRepos } from "./lin-seed";

const ctx = { userId: LIN, now: NOW };

async function tools() {
  const t = createReadTools({ repos: linRepos(await linRecommendationRows()) });
  return Object.fromEntries(t.map((x) => [x.spec.name, x])) as Record<string, ReadTool>;
}

describe("read tool registry", () => {
  it("exports exactly the architecture §6.4 read tools", () => {
    expect(readTools.map((t) => t.spec.name)).toEqual([...READ_TOOL_NAMES]);
    expect(READ_TOOL_NAMES).not.toContain("propose_action");
  });

  it("never overlaps with action tools", () => {
    const actions = new Set(actionToolSpecs.map((s) => s.name));
    expect(readTools.some((t) => actions.has(t.spec.name))).toBe(false);
  });

  it("publishes strict JSON Schemas with no user, account or recipient parameter", () => {
    for (const t of readTools) {
      const s = t.spec.inputSchema as { type: string; additionalProperties: unknown; properties?: Record<string, unknown> };
      expect(s.type).toBe("object");
      expect(s.additionalProperties).toBe(false);
      const props = Object.keys(s.properties ?? {});
      for (const bad of ["user_id", "userId", "account", "account_number", "recipient", "payee_account_ref"]) {
        expect(props).not.toContain(bad);
      }
    }
  });

  it("rejects extra arguments (including a smuggled user id)", async () => {
    const t = await tools();
    expect(t.get_balance.argsSchema.safeParse({ user_id: OTHER_USER }).success).toBe(false);
    await expect(t.list_subscriptions.run({ status: "active", userId: OTHER_USER } as never, ctx)).rejects.toThrow();
    expect(t.list_transactions.argsSchema.safeParse({ from: "2026-10-31", to: "2026-10-01" }).success).toBe(false);
    expect(t.get_fx_rate.argsSchema.safeParse({ base: "usd", quote: "CNY", date: "2026-10-17" }).success).toBe(false);
  });
});

describe("read tools over Lin's data", () => {
  it("get_balance is labeled mock_bank", async () => {
    const r = (await (await tools()).get_balance.run({}, ctx)) as Labeled<{ total: unknown }>;
    expect(r.origin).toBe("mock_bank");
    expect(r.value.total).toEqual({ amount: 9850, currency: "CNY" });
  });

  it("uses the context user, never arguments", async () => {
    const r = (await (await tools()).get_balance.run({}, { userId: OTHER_USER, now: NOW })) as Labeled<{ accounts: unknown[] }>;
    expect(r.value.accounts).toEqual([]);
  });

  it("list_transactions keeps per-row origins and source ids", async () => {
    const r = (await (await tools()).list_transactions.run({ from: "2026-10-01", to: "2026-10-31", merchant: "iqiyi" }, ctx)) as Labeled<{ amount: number }>[];
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ origin: "mock_bank", sourceId: expect.stringMatching(/^mock:tx-/), value: { amount: -30 } });
  });

  it("list_bills labels document bills as document", async () => {
    const r = (await (await tools()).list_bills.run({ status: "unpaid" }, ctx)) as Labeled<{ billerId: string }>[];
    expect(r.map((b) => [b.value.billerId, b.origin])).toEqual([
      ["CHINA_MOBILE", "mock_bank"],
      ["SZ_POWER", "document"],
      ["LANDLORD_WANG", "mock_bank"],
    ]);
    expect(JSON.stringify(r)).not.toContain("payee_account_ref");
  });

  it("list_subscriptions and compute_savings agree on annual cost", async () => {
    const t = await tools();
    const subs = (await t.list_subscriptions.run({}, ctx)) as Labeled<{ id: string; annualCost: { amount: number } }>[];
    const gpt = subs.find((s) => s.value.id === SUB.gpt)!;
    const sav = (await t.compute_savings.run({ subscription_id: SUB.gpt }, ctx)) as Labeled<{ annualSavings: { amount: number } }>;
    expect(sav.value.annualSavings.amount).toBe(gpt.value.annualCost.amount);
    expect(await t.compute_savings.run({ subscription_id: "missing" }, ctx)).toEqual({ error: "subscription_not_found" });
  });

  it("get_financial_summary returns the same figures as the route", async () => {
    const r = (await (await tools()).get_financial_summary.run({ period: "2026-10" }, ctx)) as Labeled<{ spending: { amount: number } }>;
    expect(r.value.spending.amount).toBe(992);
  });

  it("get_fx_rate is labeled fx_provider with staleness", async () => {
    const t = await tools();
    const r = (await t.get_fx_rate.run({ base: "USD", quote: "CNY", date: "2026-10-17" }, ctx)) as Labeled<{ rate: number; stale: boolean }>;
    expect(r).toMatchObject({ origin: "fx_provider", value: { rate: 7.12, stale: false } });
    expect(await t.get_fx_rate.run({ base: "USD", quote: "IDR", date: "2026-10-17" }, ctx)).toEqual({ error: "rate_unavailable" });
  });

  it("list_recommendations lists cited signals", async () => {
    const r = (await (await tools()).list_recommendations.run({}, ctx)) as Labeled<{ signals: unknown[]; score: number }>[];
    expect(r[0].value.score).toBe(8);
    expect(r.every((x) => x.value.signals.length > 0)).toBe(true);
  });

  it("list_prepaid_plans is labeled chain", async () => {
    const r = (await (await tools()).list_prepaid_plans.run({}, ctx)) as Labeled<{ balanceInEscrow: { amount: number } }>[];
    expect(r[0]).toMatchObject({ origin: "chain", sourceId: "plan:1", value: { balanceInEscrow: { amount: 4800 } } });
  });

  it("advise_prepaid returns the advisor's numbers", async () => {
    const t = await tools();
    const r = (await t.advise_prepaid.run({ offer_id: OFFER.fitbox }, ctx)) as Labeled<Record<string, unknown>>;
    expect(r.origin).toBe("simulated");
    expect(r.value).toMatchObject({ savings: { amount: 1500 }, breakEvenSessions: 48, expectedLossWithoutEscrow: { amount: 300 }, riskLevel: "watch" });
    expect(await t.advise_prepaid.run({ offer_id: "nope" }, ctx)).toEqual({ error: "offer_not_found" });
  });

  it("list_risk_signals labels soft signals with their own origin", async () => {
    const r = (await (await tools()).list_risk_signals.run({ merchant_id: "FITBOX_FUTIAN" }, ctx)) as {
      level: string;
      soft: Labeled<unknown>[];
      hard: Labeled<unknown>[];
    };
    expect(r.level).toBe("watch");
    expect(r.hard).toEqual([]);
    expect(r.soft[0]).toMatchObject({ origin: "simulated", sourceId: "sim:complaints-fitbox-2026-w42" });
  });
});
