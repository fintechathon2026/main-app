import { describe, expect, it } from "vitest";
import {
  buildAdvice,
  buildPrepaidOffers,
  buildPrepaidPlans,
  buildRecommendations,
  buildRiskSignals,
  buildSavings,
  buildSubscriptions,
  buildSummary,
  scoreRecommendations,
} from "@/src/server/db/read/views";
import { LIN, NOW, OFFER, OTHER_USER, SUB, linRecommendationRows, linRepos, riskSignals } from "./lin-seed";

const d = (repos = linRepos(), userId = LIN) => ({ repos, userId, now: NOW });

describe("buildSubscriptions (Lin)", () => {
  it("shows ChatGPT in USD with its CNY equivalent and rate date", async () => {
    const r = await buildSubscriptions(d());
    const gpt = r.items.find((i) => i.id === SUB.gpt)!;
    expect(gpt.amount).toEqual({ amount: 20, currency: "USD", base: { amount: 142, currency: "CNY", rate: 7.12, rateDate: "2026-10-16" } });
    expect(gpt.annualCost).toEqual({ amount: 1709, currency: "CNY" });
    expect(gpt.priceChange).toBeNull();
    expect(gpt.usage?.sessionsPerMonth).toBe(35);
  });

  it("derives iQIYI's price change from transactions", async () => {
    const r = await buildSubscriptions(d());
    const iq = r.items.find((i) => i.id === SUB.iqiyi)!;
    expect(iq.priceChange).toEqual({ from: { amount: 25, currency: "CNY" }, to: { amount: 30, currency: "CNY" }, at: "2026-09-05" });
    expect(iq.annualCost.amount).toBe(360);
  });

  it("labels simulated usage and computes the trial auto-cancel date", async () => {
    const r = await buildSubscriptions(d());
    const iq = r.items.find((i) => i.id === SUB.iqiyi)!;
    expect(iq.usage).toEqual({ lastUsedAt: "2026-10-02", sessionsPerMonth: 1, source: { origin: "simulated", sourceId: "mock_bank", simulated: true } });
    const trial = r.items.find((i) => i.id === SUB.keep)!;
    expect(trial.trial).toEqual({ endsAt: "2026-10-19", autoCancelAt: "2026-10-18", keepFlag: false, origin: "mock_bank" });
  });

  it("returns nothing for another user", async () => {
    expect((await buildSubscriptions(d(linRepos(), OTHER_USER))).items).toEqual([]);
  });
});

describe("buildSummary (Lin, October)", () => {
  it("computes figures from rows", async () => {
    const s = await buildSummary(d(), "2026-10");
    expect(s.income.amount).toBe(12000);
    expect(s.spending.amount).toBe(992);
    expect(s.byCategory[0]).toMatchObject({ category: "food_delivery", amount: { amount: 420 } });
    expect(s.recurring).toEqual({ bills: { amount: 3948, currency: "CNY" }, subscriptions: { amount: 187, currency: "CNY" } });
    expect(s.upcoming14d.map((u) => [u.kind, u.title, u.amount.amount])).toEqual([
      ["trial_conversion", "Keep Premium", 28],
      ["bill", "China Mobile", 88],
      ["bill", "State Grid Shenzhen", 186],
      ["renewal", "ChatGPT Plus", 20],
      ["bill", "Landlord Wang", 3500],
      ["renewal", "NetEase Cloud Music", 15],
    ]);
    expect(s.balance.amount).toBe(9850);
    expect(s.balanceAfterObligations.amount).toBe(9850 - 28 - 88 - 186 - 142 - 3500 - 15);
  });
});

describe("recommendations (Lin)", () => {
  it("scores iQIYI highest (duplicate, price increase, simulated low usage), ChatGPT FX cost", async () => {
    const { ranked } = await scoreRecommendations(d());
    expect(ranked.map((r) => [r.subscriptionId, r.score, r.signals.map((s) => s.key)])).toEqual([
      [SUB.iqiyi, 8, ["duplicate", "price_increase", "low_usage"]],
      [SUB.netease, 3, ["duplicate"]],
      [SUB.gpt, 1, ["fx_cost_high"]],
    ]);
    expect(ranked[0].signals[2].source.simulated).toBe(true);
  });

  it("serves stored rows with live annual savings", async () => {
    const rows = await linRecommendationRows();
    const r = await buildRecommendations(d(linRepos(rows)));
    expect(r.items[0]).toMatchObject({ subscriptionId: SUB.iqiyi, score: 8, annualSavings: { amount: 360, currency: "CNY" }, status: "open" });
    expect(r.items.every((i) => i.signals.length > 0)).toBe(true);
  });
});

describe("compute_savings view", () => {
  it("returns annual base amount with the rate", async () => {
    const s = await buildSavings(d(), SUB.gpt);
    expect(s).toMatchObject({ annualSavings: { amount: 1709, currency: "CNY" }, fx: { rate: 7.12, rateDate: "2026-10-16", stale: false } });
    expect(await buildSavings(d(), "nope")).toBeNull();
  });
});

describe("prepaid views (Lin)", () => {
  it("lists FitBox with 12 of 60 used and ¥4,800 in escrow", async () => {
    const r = await buildPrepaidPlans(d());
    const p = r.plans[0];
    expect(p).toMatchObject({
      unitPrice: { amount: 100, currency: "CNY" },
      unitsTotal: 60,
      unitsRedeemed: 12,
      balanceInEscrow: { amount: 4800, currency: "CNY" },
      cancelFeeBps: 1000,
      merchant: { name: "FitBox Futian", riskLevel: "watch" },
      testTokenNotice: "Test token, no value",
    });
    expect(p.sessions).toHaveLength(12);
    expect(p.purchaseTx.explorerUrl).toMatch(/^https:\/\/sepolia\.basescan\.org\/tx\/0x[0-9a-f]{64}$/);
    expect(p.signals).toEqual([
      expect.objectContaining({ tier: "soft", level: "watch", source: { origin: "simulated", sourceId: "sim:complaints-fitbox-2026-w42", simulated: true } }),
    ]);
  });

  it("offers carry total and pay-per-visit price", async () => {
    const r = await buildPrepaidOffers(d());
    expect(r.offers.map((o) => [o.merchant.name, o.total.amount, o.payPerVisitPrice.amount, o.merchant.escrowSupported])).toEqual([
      ["FitBox Futian", 6000, 125, true],
      ["IronPulse Nanshan", 4000, 100, false],
    ]);
  });

  it("advice matches PRD §15.11 (1,500 / 48 / 300) with a watch-level signal", async () => {
    const r = (await buildAdvice(d(), OFFER.fitbox))!;
    expect(r.advice).toMatchObject({
      savings: { amount: 1500, currency: "CNY" },
      breakEvenSessions: 48,
      expectedSessions: 60,
      closureRate: { value: 0.1, source: "default" },
      expectedLossWithoutEscrow: { amount: 300 },
      expectedLossWithEscrow: { amount: 0 },
      escrowAvailable: true,
      recommendation: "prepay_escrow",
    });
    expect((await buildAdvice(d(), OFFER.fitbox, { expectedSessions: 40 }))!.advice.recommendation).toBe("pay_per_visit");
    expect(await buildAdvice(d(), "missing")).toBeNull();
  });

  it("an elevated soft signal raises λ and says so", async () => {
    const elevated = [{ ...riskSignals[0], level: "elevated" as const }];
    const repos = linRepos([], { riskSignals: async () => elevated });
    const r = (await buildAdvice(d(repos), OFFER.fitbox))!;
    expect(r.offer.merchant.riskLevel).toBe("elevated");
    expect(r.advice.closureRate).toMatchObject({ source: "elevated_signal" });
    expect(r.advice.closureRate.value).toBeCloseTo(0.3);
    expect(r.advice.expectedLossWithoutEscrow.amount).toBe(900);
  });

  it("risk signals separate hard and soft with origins", async () => {
    const r = await buildRiskSignals(d(), "FITBOX_FUTIAN");
    expect(r.level).toBe("watch");
    expect(r.hard).toEqual([]);
    expect(r.soft[0].source.origin).toBe("simulated");
  });
});
