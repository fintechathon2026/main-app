import { describe, expect, it, vi } from "vitest";
import { planSubscriptionUpserts } from "@/src/core/detectors/subscriptions";
import type { ChargeTx } from "@/src/core/detectors/recurring";
import { addDays } from "@/src/core/detectors/stats";
import type { Queryable } from "@/src/server/db/read/db";
import { runDetectForUser } from "@/src/server/db/read/detect-job";
import { applyDetectPlan, recordJobRun, replaceOpenRecommendations } from "@/src/server/db/read/detect-store";
import { LIN, NOW, SUB, linRepos, transactions } from "./lin-seed";

const monthly = (start: string, n: number, amount: number): ChargeTx[] =>
  Array.from({ length: n }, (_, i) => ({ id: `t${i}`, date: addDays(start, i * 30), amount }));

describe("planSubscriptionUpserts", () => {
  it("inserts unseen recurring merchants and refreshes mock_bank rows only", () => {
    const charges = new Map<string, ChargeTx[]>([
      ["new", monthly("2026-07-01", 4, 19)],
      ["old", monthly("2026-04-01", 4, 30)],
      ["manual", monthly("2026-07-01", 4, 10)],
      ["trial", monthly("2026-07-01", 4, 10)],
      ["noise", [{ id: "x", date: "2026-10-01", amount: 99 }]],
    ]);
    const plan = planSubscriptionUpserts({
      charges,
      existing: [
        { id: "s-old", merchantId: "old", status: "active", detectionSource: "mock_bank", billingCurrency: "CNY" },
        { id: "s-man", merchantId: "manual", status: "active", detectionSource: "manual", billingCurrency: "CNY" },
        { id: "s-tri", merchantId: "trial", status: "trial", detectionSource: "mock_bank", billingCurrency: "CNY" },
      ],
      baseCurrency: "CNY",
      now: NOW,
    });
    expect(plan.inserts).toEqual([
      expect.objectContaining({ merchantId: "new", cycleDays: 30, amount: 19, billingCurrency: "CNY", originalAmount: 19, status: "active", sourceId: "detect:new" }),
    ]);
    // "old" last charged 2026-06-30, more than one cycle + 3 days before NOW → inactive (FR5.4)
    expect(plan.updates).toEqual([expect.objectContaining({ id: "s-old", status: "inactive" })]);
  });
});

function recorder(rows: unknown[][] = []): Queryable & { calls: { text: string; values?: unknown[] }[] } {
  const calls: { text: string; values?: unknown[] }[] = [];
  let i = 0;
  return {
    calls,
    async query(text: string, values?: unknown[]) {
      calls.push({ text, values });
      return { rows: rows[i++] ?? [] };
    },
  };
}

describe("detect store", () => {
  it("writes inserts with user id and updates scoped to mock_bank rows", async () => {
    const q = recorder();
    await applyDetectPlan(q, LIN, {
      inserts: [{ merchantId: "m", cycleDays: 30, amount: 19, currency: "CNY", billingCurrency: "CNY", originalAmount: 19, nextRenewal: "2026-11-01", status: "active", firstSeen: "2026-07-01", lastCharged: "2026-10-01", confidence: 0.9, sourceId: "detect:m" }],
      updates: [{ id: "s1", status: "inactive", lastCharged: "2026-08-01", nextRenewal: "2026-08-31", confidence: 0.8 }],
    });
    expect(q.calls[0].values?.[0]).toBe(LIN);
    expect(q.calls[1].text).toContain("detection_source = 'mock_bank'");
    expect(q.calls[1].values?.slice(0, 2)).toEqual([LIN, "s1"]);
  });

  it("keeps decided recommendations and replaces open ones", async () => {
    const q = recorder([[{ subscription_id: "s-dismissed" }]]);
    const sig = { key: "duplicate" as const, points: 3, detail: "d", source: { origin: "mock_bank" as const } };
    const n = await replaceOpenRecommendations(q, LIN, [
      { subscriptionId: "s-dismissed", score: 3, signals: [sig], noUsageData: true },
      { subscriptionId: "s-new", score: 3, signals: [sig], noUsageData: true },
    ]);
    expect(n).toBe(1);
    expect(q.calls[1].text).toContain("status = 'open'");
    expect(q.calls[2].values?.[1]).toBe("s-new");
  });

  it("records job runs, including failures", async () => {
    const ok = recorder([[{ id: "j1" }]]);
    expect(await recordJobRun(ok, "fx", async () => 4, (n) => ({ n }))).toBe(4);
    expect(ok.calls[1].text).toContain("'succeeded'");
    const bad = recorder([[{ id: "j2" }]]);
    await expect(recordJobRun(bad, "fx", async () => { throw new Error("boom"); }, () => ({}))).rejects.toThrow("boom");
    expect(bad.calls[1].values).toEqual(["j2", "boom"]);
  });
});

describe("runDetectForUser (Lin)", () => {
  it("refreshes existing rows and writes Lin's ranked recommendations", async () => {
    const writes: Queryable & { calls: { text: string; values?: unknown[] }[] } = recorder();
    const r = await runDetectForUser(LIN, NOW, { repos: linRepos(), tx: (_u, fn) => fn(writes) });
    expect(r.inserted).toBe(0); // every recurring merchant in the seed already has a row
    expect(r.updated).toBe(3); // ChatGPT (USD, via original_amount), iQIYI, NetEase
    expect(r.recommendations).toBe(3);
    const recInserts = writes.calls.filter((c) => c.text.includes("insert into public.recommendations"));
    expect(recInserts[0].values?.[1]).toBe(SUB.iqiyi);
  });

  it("detects a new recurring merchant from transactions", async () => {
    const extra = [0, 1, 2].map((i) => ({ ...transactions[0], id: `n${i}`, merchant_id: "m-new", merchant_name: "Bilibili", category: "entertainment", amount: -12, original_amount: null, original_currency: null, posted_at: `${addDays("2026-07-20", i * 30)}T00:00:00.000Z` }));
    const repos = linRepos([], { transactions: async () => [...transactions, ...extra] });
    const spy = vi.fn();
    const r = await runDetectForUser(LIN, NOW, { repos, tx: (_u, fn) => fn({ query: async (t, v) => (spy(t, v), { rows: [] }) }) });
    expect(r.inserted).toBe(1);
    expect(spy.mock.calls.some(([t, v]) => String(t).includes("insert into public.subscriptions") && (v as unknown[])[1] === "m-new")).toBe(true);
  });
});
