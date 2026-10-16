import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type SummaryInput, computeSummary } from "@/src/core/algorithms/summary";

const input: SummaryInput = {
  period: "2026-10",
  baseCurrency: "CNY",
  now: "2026-10-17T09:00:00.000Z",
  balance: 9850,
  previousPeriodSpending: 5000,
  transactions: [
    { id: "salary", date: "2026-10-10", amountBase: 12000, category: "income" },
    { id: "rent", date: "2026-10-01", amountBase: -3500, category: "housing" },
    { id: "food1", date: "2026-10-03", amountBase: -40, category: "food" },
    { id: "food2", date: "2026-10-12", amountBase: -60, category: null },
    { id: "sept", date: "2026-09-30", amountBase: -999, category: "food" },
  ],
  bills: [
    { id: "b-mobile", title: "China Mobile", dueDate: "2026-10-20", amount: 88, status: "pending" },
    { id: "b-power", title: "Shenzhen Power", dueDate: "2026-10-22", amount: 186, status: "pending" },
    { id: "b-old", title: "Shenzhen Power", dueDate: "2026-10-02", amount: 174, status: "paid" },
    { id: "b-far", title: "Rent", dueDate: "2026-11-02", amount: 3500, status: "pending" },
  ],
  subscriptions: [
    {
      id: "s-gpt",
      title: "ChatGPT Plus",
      status: "active",
      amount: { amount: 20, currency: "USD", base: { amount: 142, currency: "CNY", rate: 7.12, rateDate: "2026-10-16" } },
      monthlyBase: 142,
      nextRenewal: "2026-10-24",
      trial: null,
      priceChange: null,
    },
    {
      id: "s-iqiyi",
      title: "iQIYI",
      status: "active",
      amount: { amount: 30, currency: "CNY" },
      monthlyBase: 30,
      nextRenewal: "2026-11-05",
      trial: null,
      priceChange: { from: { amount: 25, currency: "CNY" }, to: { amount: 30, currency: "CNY" }, at: "2026-09-05" },
    },
    {
      id: "s-trial",
      title: "Tencent Video",
      status: "trial",
      amount: { amount: 30, currency: "CNY" },
      monthlyBase: 30,
      nextRenewal: null,
      trial: { endsAt: "2026-10-21", keepFlag: false },
      priceChange: null,
    },
  ],
  prepaidSessions: [{ planId: "p1", title: "FitBox Futian", date: "2026-10-19", amount: 100 }],
};

describe("computeSummary (FR12a.1)", () => {
  const r = computeSummary(input);

  it("splits income and spending within the period only", () => {
    expect(r.income).toEqual({ amount: 12000, currency: "CNY" });
    expect(r.spending).toEqual({ amount: 3600, currency: "CNY" });
  });

  it("groups spending by category with transaction ids", () => {
    expect(r.byCategory).toEqual([
      { category: "housing", amount: { amount: 3500, currency: "CNY" }, transactionIds: ["rent"] },
      { category: "uncategorized", amount: { amount: 60, currency: "CNY" }, transactionIds: ["food2"] },
      { category: "food", amount: { amount: 40, currency: "CNY" }, transactionIds: ["food1"] },
    ]);
  });

  it("sums recurring obligations", () => {
    // October bills (paid or not): 88 + 186 + 174; active subscriptions monthly: 142 + 30.
    expect(r.recurring).toEqual({ bills: { amount: 448, currency: "CNY" }, subscriptions: { amount: 172, currency: "CNY" } });
  });

  it("lists the next 14 days in date order, with base equivalents", () => {
    expect(r.upcoming14d.map((u) => [u.kind, u.refId, u.dueDate])).toEqual([
      ["prepaid_session", "p1", "2026-10-19"],
      ["bill", "b-mobile", "2026-10-20"],
      ["trial_conversion", "s-trial", "2026-10-21"],
      ["bill", "b-power", "2026-10-22"],
      ["renewal", "s-gpt", "2026-10-24"],
    ]);
    expect(r.upcoming14d[4].amount.base?.rateDate).toBe("2026-10-16");
  });

  it("subtracts upcoming obligations (not prepaid sessions) from the balance", () => {
    expect(r.balanceAfterObligations.amount).toBe(9850 - 88 - 30 - 186 - 142);
  });

  it("writes insights from code with their ids", () => {
    const keys = r.insights.map((i) => i.key);
    expect(keys).toEqual(["top_category", "subscription_total", "price_change", "trial_converting", "month_over_month"]);
    expect(r.insights[0].text).toBe("Housing is your largest category this month: ¥3,500 (97% of spending).");
    expect(r.insights[1].text).toContain("ChatGPT Plus");
    expect(r.insights[2]).toMatchObject({ amount: { amount: 5, currency: "CNY" }, refIds: ["s-iqiyi"] });
    expect(r.insights[3].text).toBe("Tencent Video trial converts to ¥30 in 4 days (2026-10-21).");
    expect(r.insights[4].text).toBe("Spending is down 28% versus last month (¥1,400).");
  });

  it("rejects a malformed period", () => {
    expect(() => computeSummary({ ...input, period: "2026-13" })).toThrow(RangeError);
  });

  it("property: category totals add up to spending", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            day: fc.integer({ min: 1, max: 31 }),
            amount: fc.integer({ min: -5000, max: 5000 }),
            category: fc.constantFrom("food", "transport", null),
          }),
          { maxLength: 40 },
        ),
        (rows) => {
          const txs = rows.map((x, i) => ({
            id: `t${i}`,
            date: `2026-10-${String(x.day).padStart(2, "0")}`,
            amountBase: x.amount,
            category: x.category,
          }));
          const s = computeSummary({ ...input, transactions: txs, previousPeriodSpending: null });
          const sum = s.byCategory.reduce((a, c) => a + c.amount.amount, 0);
          expect(sum).toBe(s.spending.amount);
          expect(s.income.amount - s.spending.amount).toBe(txs.reduce((a, t) => a + t.amountBase, 0));
        },
      ),
    );
  });
});
