// Cancel-recommendation score (PRD §15.9, FR5.10). Pure and interpretable: each fired signal
// carries its points, a code-written detail and its source. The LLM never sets the score.
//
// score(s) = 3·duplicate + 2·price_increase + 2·trial_converted + 3·low_usage
//          + 1·fx_cost_high + 1·high_share
// `low_usage` fires only when usage data exists (FR5.3); otherwise the item says "no usage data".

import { daysBetween } from "@/src/core/detectors/stats";
import { type Money, type SourceRef, fmt } from "./money";

export const REC_WEIGHTS = {
  duplicate: 3,
  price_increase: 2,
  trial_converted: 2,
  low_usage: 3,
  fx_cost_high: 1,
  high_share: 1,
} as const;

export type SignalKey = keyof typeof REC_WEIGHTS;

export type RecSignal = { key: SignalKey; points: number; detail: string; source: SourceRef };

export type RecThresholds = {
  lowUsageSessionsPerMonth: number; // fewer than this → low usage
  fxCostHighAnnual: number; // base currency per year
  highSharePct: number; // of monthly spending
};

export const DEFAULT_REC_THRESHOLDS: RecThresholds = {
  lowUsageSessionsPerMonth: 2,
  fxCostHighAnnual: 20,
  highSharePct: 0.1,
};

export type RecSubscription = {
  id: string;
  name: string;
  category: string;
  status: "active" | "inactive" | "cancelled" | "trial";
  cycleDays: number;
  monthlyBase: number; // base currency
  source: SourceRef; // where the subscription itself was detected
  priceChange: { from: Money; to: Money; at: string } | null;
  trial: { endsAt: string; origin: SourceRef["origin"] } | null;
  firstPaidChargeAt: string | null; // first charge after the trial ended
  usage: { sessionsPerMonth: number | null; source: SourceRef } | null;
  fxCost: { annual: number; rateDate: string } | null; // from fxCostEstimate, base currency
};

export type RecContext = {
  others: readonly RecSubscription[];
  monthlySpending: number; // base currency, ≥ 0
  baseCurrency: string;
  now: string;
  thresholds?: Partial<RecThresholds>;
};

export type RecScore = { subscriptionId: string; score: number; signals: RecSignal[]; noUsageData: boolean };

const LIVE = new Set(["active", "trial"]);

export function scoreSubscription(s: RecSubscription, ctx: RecContext): RecScore {
  const t = { ...DEFAULT_REC_THRESHOLDS, ...ctx.thresholds };
  const signals: RecSignal[] = [];
  const base = (amount: number): Money => ({ amount, currency: ctx.baseCurrency });

  const dup = ctx.others.find((o) => o.id !== s.id && LIVE.has(o.status) && o.category === s.category);
  if (dup) {
    signals.push({
      key: "duplicate",
      points: REC_WEIGHTS.duplicate,
      detail: `Also subscribed to ${dup.name} in the same category (${s.category}).`,
      source: { ...dup.source, sourceId: dup.id },
    });
  }

  if (s.priceChange && s.priceChange.to.amount > s.priceChange.from.amount) {
    signals.push({
      key: "price_increase",
      points: REC_WEIGHTS.price_increase,
      detail: `Price went from ${fmt(s.priceChange.from)} to ${fmt(s.priceChange.to)} on ${s.priceChange.at}.`,
      source: { ...s.source, sourceId: s.id },
    });
  }

  if (
    s.trial &&
    s.firstPaidChargeAt &&
    s.firstPaidChargeAt >= s.trial.endsAt.slice(0, 10) &&
    daysBetween(s.firstPaidChargeAt, ctx.now) <= s.cycleDays
  ) {
    signals.push({
      key: "trial_converted",
      points: REC_WEIGHTS.trial_converted,
      detail: `Free trial converted to paid on ${s.firstPaidChargeAt}.`,
      source: { origin: s.trial.origin, sourceId: s.id },
    });
  }

  const noUsageData = !s.usage || s.usage.sessionsPerMonth === null;
  if (s.usage && s.usage.sessionsPerMonth !== null && s.usage.sessionsPerMonth < t.lowUsageSessionsPerMonth) {
    signals.push({
      key: "low_usage",
      points: REC_WEIGHTS.low_usage,
      detail: `Used ${s.usage.sessionsPerMonth} times per month (below ${t.lowUsageSessionsPerMonth}).`,
      source: s.usage.source,
    });
  }

  if (s.fxCost && s.fxCost.annual > t.fxCostHighAnnual) {
    signals.push({
      key: "fx_cost_high",
      points: REC_WEIGHTS.fx_cost_high,
      detail: `Estimated card FX markup about ${fmt(base(Math.round(s.fxCost.annual)))} per year (rate of ${s.fxCost.rateDate}).`,
      source: { origin: "fx_provider", sourceId: s.fxCost.rateDate },
    });
  }

  if (ctx.monthlySpending > 0 && s.monthlyBase / ctx.monthlySpending > t.highSharePct) {
    const pct = Math.round((s.monthlyBase / ctx.monthlySpending) * 100);
    signals.push({
      key: "high_share",
      points: REC_WEIGHTS.high_share,
      detail: `${fmt(base(s.monthlyBase))} per month is ${pct}% of this month's spending.`,
      source: { ...s.source, sourceId: s.id },
    });
  }

  return { subscriptionId: s.id, score: signals.reduce((a, x) => a + x.points, 0), signals, noUsageData };
}

/** Scores every live subscription; returns those with at least one signal, highest score first. */
export function rankRecommendations(subs: readonly RecSubscription[], ctx: Omit<RecContext, "others">): RecScore[] {
  return subs
    .filter((s) => LIVE.has(s.status))
    .map((s) => scoreSubscription(s, { ...ctx, others: subs }))
    .filter((r) => r.signals.length > 0)
    .sort((a, b) => b.score - a.score || a.subscriptionId.localeCompare(b.subscriptionId));
}
