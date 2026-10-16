// Financial summary figures (FR12a.1, FR12a.3). Pure: the caller loads rows and passes `now`.
// Every figure carries the ids it was computed from, so the UI can drill down (FR12a AC) and the
// Explainer can only rephrase numbers produced here (FR12a.4).

import { addDays, daysBetween, periodBounds } from "@/src/core/detectors/stats";
import { type FxMoney, type Money, baseAmountOf, fmt, roundBase } from "./money";

export const UPCOMING_WINDOW_DAYS = 14;

export type SummaryTx = {
  id: string;
  date: string;
  amountBase: number; // signed: > 0 income, < 0 spending
  category: string | null;
};

export type SummaryBill = { id: string; title: string; dueDate: string; amount: number; status: string };

export type SummarySubscription = {
  id: string;
  title: string;
  status: "active" | "inactive" | "cancelled" | "trial";
  amount: FxMoney; // per cycle
  monthlyBase: number | null; // null if a foreign amount has no rate
  nextRenewal: string | null;
  trial: { endsAt: string; keepFlag: boolean } | null;
  priceChange: { from: Money; to: Money; at: string } | null;
};

export type SummaryPrepaidSession = { planId: string; title: string; date: string; amount: number };

export type SummaryInput = {
  period: string; // YYYY-MM
  baseCurrency: string;
  now: string;
  balance: number;
  transactions: readonly SummaryTx[]; // any range; filtered to the period here
  previousPeriodSpending?: number | null;
  /** "month_to_date": the previous figure covers the same days of last month (current period). */
  previousComparison?: "full_month" | "month_to_date";
  bills: readonly SummaryBill[];
  subscriptions: readonly SummarySubscription[];
  prepaidSessions?: readonly SummaryPrepaidSession[];
};

export type UpcomingItem = {
  kind: "bill" | "renewal" | "trial_conversion" | "prepaid_session";
  title: string;
  dueDate: string;
  amount: FxMoney;
  refId: string;
};

export type Insight = { key: string; text: string; amount?: Money; refIds: string[] };

export type SummaryResult = {
  period: string;
  baseCurrency: string;
  income: Money;
  spending: Money;
  byCategory: { category: string; amount: Money; transactionIds: string[] }[];
  recurring: { bills: Money; subscriptions: Money };
  upcoming14d: UpcomingItem[];
  balance: Money;
  balanceAfterObligations: Money;
  insights: Insight[];
};

/** Bill statuses that no longer need money. */
export const SETTLED_BILL_STATUSES = new Set(["paid", "cancelled"]);

const KIND_ORDER: Record<UpcomingItem["kind"], number> = { bill: 0, trial_conversion: 1, renewal: 2, prepaid_session: 3 };

export function computeSummary(input: SummaryInput): SummaryResult {
  const { baseCurrency: cur } = input;
  const money = (amount: number): Money => ({ amount: roundBase(amount), currency: cur });
  const { from, toExclusive } = periodBounds(input.period);
  const inPeriod = (d: string) => d.slice(0, 10) >= from && d.slice(0, 10) < toExclusive;
  const today = input.now.slice(0, 10);
  const horizon = addDays(today, UPCOMING_WINDOW_DAYS);
  const inWindow = (d: string | null): d is string => !!d && d.slice(0, 10) >= today && d.slice(0, 10) <= horizon;

  // Income and spending by category.
  const txs = input.transactions.filter((t) => inPeriod(t.date));
  let income = 0;
  let spending = 0;
  const cats = new Map<string, { total: number; ids: string[] }>();
  for (const t of txs) {
    if (t.amountBase > 0) {
      income += t.amountBase;
      continue;
    }
    const amt = -t.amountBase;
    spending += amt;
    const key = t.category ?? "uncategorized";
    const c = cats.get(key) ?? { total: 0, ids: [] };
    c.total += amt;
    c.ids.push(t.id);
    cats.set(key, c);
  }
  const byCategory = [...cats.entries()]
    .map(([category, c]) => ({ category, amount: money(c.total), transactionIds: c.ids }))
    .sort((a, b) => b.amount.amount - a.amount.amount || a.category.localeCompare(b.category));

  // Recurring obligations for the period.
  const periodBills = input.bills.filter((b) => inPeriod(b.dueDate));
  const billsTotal = periodBills.reduce((a, b) => a + b.amount, 0);
  const activeSubs = input.subscriptions.filter((s) => s.status === "active");
  const subsMonthly = activeSubs.reduce((a, s) => a + (s.monthlyBase ?? 0), 0);

  // Upcoming 14 days from `now`.
  const upcoming: UpcomingItem[] = [];
  for (const b of input.bills) {
    if (!SETTLED_BILL_STATUSES.has(b.status) && inWindow(b.dueDate)) {
      upcoming.push({ kind: "bill", title: b.title, dueDate: b.dueDate.slice(0, 10), amount: { amount: b.amount, currency: cur }, refId: b.id });
    }
  }
  for (const s of input.subscriptions) {
    if (s.status === "trial" && s.trial && inWindow(s.trial.endsAt)) {
      upcoming.push({ kind: "trial_conversion", title: s.title, dueDate: s.trial.endsAt.slice(0, 10), amount: s.amount, refId: s.id });
    } else if (s.status === "active" && inWindow(s.nextRenewal)) {
      upcoming.push({ kind: "renewal", title: s.title, dueDate: s.nextRenewal.slice(0, 10), amount: s.amount, refId: s.id });
    }
  }
  for (const p of input.prepaidSessions ?? []) {
    if (inWindow(p.date)) {
      upcoming.push({ kind: "prepaid_session", title: p.title, dueDate: p.date.slice(0, 10), amount: { amount: p.amount, currency: cur }, refId: p.planId });
    }
  }
  upcoming.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.refId.localeCompare(b.refId));
  // Prepaid sessions are already paid into escrow, so they do not reduce the balance.
  const obligations = upcoming
    .filter((u) => u.kind !== "prepaid_session")
    .reduce((a, u) => a + (baseAmountOf(u.amount, cur) ?? 0), 0);

  // Insights, each with a code-written text and the ids behind it.
  const insights: Insight[] = [];
  const top = byCategory[0];
  if (top && spending > 0) {
    const pct = Math.round((top.amount.amount / roundBase(spending)) * 100);
    insights.push({
      key: "top_category",
      text: `${capitalize(top.category)} is your largest category this month: ${fmt(top.amount)} (${pct}% of spending).`,
      amount: top.amount,
      refIds: top.transactionIds,
    });
  }
  if (activeSubs.length > 0) {
    const foreign = activeSubs.filter((s) => s.amount.currency !== cur).map((s) => s.title);
    const monthly = money(subsMonthly);
    insights.push({
      key: "subscription_total",
      text:
        `Subscriptions cost ${fmt(monthly)} per month (${fmt(money(subsMonthly * 12))} per year)` +
        (foreign.length ? `, including ${foreign.join(", ")} converted from a foreign currency.` : "."),
      amount: monthly,
      refIds: activeSubs.map((s) => s.id),
    });
  }
  for (const s of input.subscriptions) {
    if (s.priceChange && s.status !== "cancelled" && s.priceChange.to.amount !== s.priceChange.from.amount) {
      const diff = s.priceChange.to.amount - s.priceChange.from.amount;
      insights.push({
        key: "price_change",
        text: `${s.title} went from ${fmt(s.priceChange.from)} to ${fmt(s.priceChange.to)} on ${s.priceChange.at}.`,
        amount: { amount: Math.round(diff * 100) / 100, currency: s.priceChange.to.currency },
        refIds: [s.id],
      });
    }
  }
  for (const u of upcoming.filter((x) => x.kind === "trial_conversion")) {
    const s = input.subscriptions.find((x) => x.id === u.refId);
    const days = daysBetween(today, u.dueDate);
    insights.push({
      key: "trial_converting",
      text: `${u.title} trial converts to ${fmt(u.amount)} in ${days} day${days === 1 ? "" : "s"} (${u.dueDate})${s?.trial?.keepFlag ? "; you chose to keep it" : ""}.`,
      amount: { amount: u.amount.amount, currency: u.amount.currency },
      refIds: [u.refId],
    });
  }
  if (input.previousPeriodSpending && input.previousPeriodSpending > 0) {
    const change = spending - input.previousPeriodSpending;
    const pct = Math.round((change / input.previousPeriodSpending) * 100);
    insights.push({
      key: "month_over_month",
      text: `Spending is ${pct >= 0 ? "up" : "down"} ${Math.abs(pct)}% versus ${input.previousComparison === "month_to_date" ? "the same days last month" : "last month"} (${fmt(money(Math.abs(change)))}).`,
      amount: money(change),
      refIds: txs.filter((t) => t.amountBase < 0).map((t) => t.id),
    });
  }

  return {
    period: input.period,
    baseCurrency: cur,
    income: money(income),
    spending: money(spending),
    byCategory,
    recurring: { bills: money(billsTotal), subscriptions: money(subsMonthly) },
    upcoming14d: upcoming,
    balance: money(input.balance),
    balanceAfterObligations: money(input.balance - obligations),
    insights,
  };
}

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
