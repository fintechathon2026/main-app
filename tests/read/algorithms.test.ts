import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DEFAULT_FX_MARKUP_PCT, computeSavings, cyclesPerYear, fxCostEstimate } from "@/src/core/algorithms/fx";
import { fmt, fxMoney } from "@/src/core/algorithms/money";
import {
  REC_WEIGHTS,
  type RecSubscription,
  rankRecommendations,
  scoreSubscription,
} from "@/src/core/algorithms/recommendation";

const fx = { rate: 7.12, rateDate: "2026-10-16" };

describe("cyclesPerYear", () => {
  it("maps common cycles", () => {
    expect(cyclesPerYear(7)).toBe(52);
    expect(cyclesPerYear(30)).toBe(12);
    expect(cyclesPerYear(31)).toBe(12);
    expect(cyclesPerYear(365)).toBe(1);
    expect(cyclesPerYear(90)).toBeCloseTo(4.06, 2);
    expect(() => cyclesPerYear(0)).toThrow(RangeError);
  });
});

describe("fxCostEstimate (PRD §15.10)", () => {
  it("computes original × cycles × rate × markup", () => {
    const r = fxCostEstimate({ originalAmount: 20, originalCurrency: "USD", baseCurrency: "CNY", cycleDays: 30, fx })!;
    expect(r.annualFxCost).toBeCloseTo(20 * 12 * 7.12 * DEFAULT_FX_MARKUP_PCT, 2);
    expect(r.annualBase).toBe(1709);
    expect(r.rateDate).toBe("2026-10-16");
    expect(r.assumptions.join(" ")).toContain("2026-10-16");
  });
  it("is null for base-currency plans", () => {
    expect(fxCostEstimate({ originalAmount: 25, originalCurrency: "CNY", baseCurrency: "CNY", cycleDays: 30, fx })).toBeNull();
  });
});

describe("computeSavings (FR5.8)", () => {
  it("annualizes base-currency plans", () => {
    const r = computeSavings({ amount: 30, currency: "CNY", cycleDays: 30, baseCurrency: "CNY", fx: null })!;
    expect(r.annualBase).toEqual({ amount: 360, currency: "CNY" });
    expect(r.monthlyBase.amount).toBe(30);
    expect(r.fx).toBeNull();
  });
  it("converts foreign plans with the rate and its date", () => {
    const r = computeSavings({ amount: 20, currency: "USD", cycleDays: 30, baseCurrency: "CNY", fx })!;
    expect(r.annualOriginal).toEqual({ amount: 240, currency: "USD" });
    expect(r.annualBase).toEqual({ amount: 1709, currency: "CNY" });
    expect(r.monthlyBase.amount).toBe(142);
    expect(r.fx).toEqual(fx);
  });
  it("returns null without a rate for a foreign plan", () => {
    expect(computeSavings({ amount: 20, currency: "USD", cycleDays: 30, baseCurrency: "CNY", fx: null })).toBeNull();
  });
  it("property: annual base is monotone in the amount", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000 }), fc.integer({ min: 0, max: 10_000 }), (a, b) => {
        const s = (x: number) => computeSavings({ amount: x, currency: "CNY", cycleDays: 30, baseCurrency: "CNY", fx: null })!.annualBase.amount;
        if (a <= b) expect(s(a)).toBeLessThanOrEqual(s(b));
      }),
    );
  });
});

describe("money helpers", () => {
  it("formats and attaches base equivalents", () => {
    expect(fmt({ amount: 3500, currency: "CNY" })).toBe("¥3,500");
    expect(fmt({ amount: 20, currency: "USD" })).toBe("$20");
    expect(fmt({ amount: 1.5, currency: "XYZ" })).toBe("XYZ 1.50");
    expect(fxMoney(20, "USD", "CNY", fx)).toEqual({
      amount: 20,
      currency: "USD",
      base: { amount: 142, currency: "CNY", rate: 7.12, rateDate: "2026-10-16" },
    });
    expect(fxMoney(25, "CNY", "CNY", fx)).toEqual({ amount: 25, currency: "CNY" });
  });
});

const sub = (over: Partial<RecSubscription>): RecSubscription => ({
  id: "s1",
  name: "iQIYI",
  category: "video",
  status: "active",
  cycleDays: 30,
  monthlyBase: 30,
  source: { origin: "mock_bank" },
  priceChange: null,
  trial: null,
  firstPaidChargeAt: null,
  usage: null,
  fxCost: null,
  ...over,
});
const ctx = { monthlySpending: 5000, baseCurrency: "CNY", now: "2026-10-17" };

describe("scoreSubscription (PRD §15.9)", () => {
  it("scores nothing and reports no usage data for a plain plan", () => {
    const r = scoreSubscription(sub({}), { ...ctx, others: [] });
    expect(r).toEqual({ subscriptionId: "s1", score: 0, signals: [], noUsageData: true });
  });

  it("fires duplicate with the other plan as source", () => {
    const other = sub({ id: "s2", name: "Tencent Video", status: "trial" });
    const r = scoreSubscription(sub({}), { ...ctx, others: [other] });
    expect(r.score).toBe(REC_WEIGHTS.duplicate);
    expect(r.signals[0]).toMatchObject({ key: "duplicate", source: { origin: "mock_bank", sourceId: "s2" } });
  });

  it("ignores cancelled duplicates", () => {
    const other = sub({ id: "s2", status: "cancelled" });
    expect(scoreSubscription(sub({}), { ...ctx, others: [other] }).score).toBe(0);
  });

  it("fires price_increase only on increases", () => {
    const up = sub({ priceChange: { from: { amount: 25, currency: "CNY" }, to: { amount: 30, currency: "CNY" }, at: "2026-09-05" } });
    expect(scoreSubscription(up, { ...ctx, others: [] }).signals.map((s) => s.key)).toEqual(["price_increase"]);
    const down = sub({ priceChange: { from: { amount: 30, currency: "CNY" }, to: { amount: 25, currency: "CNY" }, at: "2026-09-05" } });
    expect(scoreSubscription(down, { ...ctx, others: [] }).score).toBe(0);
  });

  it("fires trial_converted within one cycle of the first paid charge", () => {
    const s = sub({ trial: { endsAt: "2026-10-01", origin: "mock_bank" }, firstPaidChargeAt: "2026-10-01" });
    expect(scoreSubscription(s, { ...ctx, others: [] }).signals[0]).toMatchObject({ key: "trial_converted", points: 2 });
    expect(scoreSubscription(s, { ...ctx, now: "2026-11-15", others: [] }).score).toBe(0);
  });

  it("fires low_usage only with usage data, and keeps the simulated label", () => {
    const low = sub({ usage: { sessionsPerMonth: 1, source: { origin: "simulated", simulated: true } } });
    const r = scoreSubscription(low, { ...ctx, others: [] });
    expect(r.noUsageData).toBe(false);
    expect(r.signals[0]).toMatchObject({ key: "low_usage", points: 3, source: { simulated: true } });
    const unknown = sub({ usage: { sessionsPerMonth: null, source: { origin: "simulated" } } });
    expect(scoreSubscription(unknown, { ...ctx, others: [] })).toMatchObject({ score: 0, noUsageData: true });
    const busy = sub({ usage: { sessionsPerMonth: 12, source: { origin: "simulated" } } });
    expect(scoreSubscription(busy, { ...ctx, others: [] }).score).toBe(0);
  });

  it("fires fx_cost_high with fx_provider as source", () => {
    const s = sub({ fxCost: { annual: 25.63, rateDate: "2026-10-16" } });
    expect(scoreSubscription(s, { ...ctx, others: [] }).signals[0]).toMatchObject({
      key: "fx_cost_high",
      points: 1,
      source: { origin: "fx_provider", sourceId: "2026-10-16" },
    });
  });

  it("fires high_share above 10% of monthly spending", () => {
    expect(scoreSubscription(sub({ monthlyBase: 600 }), { ...ctx, others: [] }).signals[0].key).toBe("high_share");
    expect(scoreSubscription(sub({ monthlyBase: 500 }), { ...ctx, others: [] }).score).toBe(0);
  });

  it("property: score equals the sum of fired points and is within [0, 12]", () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.boolean(),
        fc.option(fc.integer({ min: 0, max: 30 })),
        fc.integer({ min: 0, max: 3000 }),
        fc.integer({ min: 0, max: 100 }),
        (dup, inc, sessions, monthly, fxAnnual) => {
          const s = sub({
            monthlyBase: monthly,
            priceChange: inc ? { from: { amount: 1, currency: "CNY" }, to: { amount: 2, currency: "CNY" }, at: "2026-09-01" } : null,
            usage: sessions === null ? null : { sessionsPerMonth: sessions, source: { origin: "simulated" } },
            fxCost: { annual: fxAnnual, rateDate: "2026-10-16" },
          });
          const others = dup ? [sub({ id: "x" })] : [];
          const r = scoreSubscription(s, { ...ctx, others });
          expect(r.score).toBe(r.signals.reduce((a, x) => a + x.points, 0));
          expect(r.score).toBeGreaterThanOrEqual(0);
          expect(r.score).toBeLessThanOrEqual(12);
          if (sessions === null) expect(r.signals.some((x) => x.key === "low_usage")).toBe(false);
        },
      ),
    );
  });
});

describe("rankRecommendations", () => {
  it("ranks live subscriptions with signals, highest first", () => {
    const subs = [
      sub({ id: "a", category: "music" }),
      sub({ id: "b", priceChange: { from: { amount: 25, currency: "CNY" }, to: { amount: 30, currency: "CNY" }, at: "2026-09-05" } }),
      sub({ id: "c", status: "trial" }),
      sub({ id: "d", status: "cancelled" }),
    ];
    const r = rankRecommendations(subs, ctx);
    expect(r.map((x) => [x.subscriptionId, x.score])).toEqual([
      ["b", 5],
      ["c", 3],
    ]);
  });
});
