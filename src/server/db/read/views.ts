// Read-side view builders shared by UI routes and read tools, so the agent and the screens show
// the same numbers (G6: numbers come from code). Each builder loads rows through `ReadRepos` and
// runs the pure detectors/algorithms from src/core.

import { advisePrepaid } from "@/src/core/algorithms/advisor";
import { type FxCostResult, computeSavings, fxCostEstimate } from "@/src/core/algorithms/fx";
import { type Money, fxMoney, roundBase } from "@/src/core/algorithms/money";
import { type RecSubscription, rankRecommendations } from "@/src/core/algorithms/recommendation";
import { computeSummary } from "@/src/core/algorithms/summary";
import { type ChargeTx, type RateLookup, type RecurringResult, detectRecurring } from "@/src/core/detectors/recurring";
import { addDays, daysBetween, periodBounds, previousPeriod } from "@/src/core/detectors/stats";
import type { Origin } from "@/src/core/types";
import type {
  PrepaidAdviceResponse,
  PrepaidOfferItem,
  PrepaidOffersResponse,
  PrepaidPlanItem,
  PrepaidPlansResponse,
  PrepaidSignal,
  RecommendationsResponse,
  SubscriptionItem,
  SubscriptionsResponse,
  SummaryResponse,
} from "../../api-types";
import { type RateInfo, getRate } from "../../fx/frankfurter";
import { chainTxRef } from "./db";
import type { PrepaidOfferRow, RiskLevel } from "./prepaid";
import type { ReadRepos } from "./repos";
import type { AttestationRow, RiskSignalRow } from "./risk";
import type { UserSettings } from "./settings";
import type { SubscriptionRow, UsageSignalRow } from "./subscriptions";
import type { TransactionRow } from "./transactions";

export type ViewDeps = { repos: ReadRepos; userId: string; now: string };

export const DETECTION_LOOKBACK_DAYS = 400;
export const SOFT_SIGNAL_WINDOW_DAYS = 30;
export const TEST_TOKEN_NOTICE = "Test token, no value";
/** `sessions_per_month` (as seeded) is used as is; `sessions` over a period is scaled to 30 days. */
export const USAGE_METRICS = { perMonth: "sessions_per_month", sessions: "sessions", lastUsed: "last_used" } as const;

const today = (d: ViewDeps) => d.now.slice(0, 10);
const fenToYuan = (fen: number) => Math.round(fen) / 100;

export function rateLookupFor(d: ViewDeps) {
  return (base: string, quote: string, date: string): Promise<RateInfo | null> =>
    getRate(base, quote, date, (b, q, dd) => d.repos.fxRate(d.userId, b, q, dd));
}

export const DETECTION_ORIGIN: Record<SubscriptionRow["detection_source"], Origin> = {
  mock_bank: "mock_bank",
  manual: "user",
  email: "email",
  csv: "csv",
};

// ---- Subscriptions ----------------------------------------------------------------------

export type EnrichedSubscription = {
  row: SubscriptionRow;
  item: SubscriptionItem;
  monthlyBase: number | null;
  fx: RateInfo | null;
  detection: RecurringResult | null;
  firstPaidChargeAt: string | null;
  fxCost: FxCostResult | null;
};

export type SubscriptionContext = {
  settings: UserSettings;
  baseCurrency: string;
  subs: EnrichedSubscription[];
  transactions: TransactionRow[];
  /** Posting-date rates (≤ 7 days old) for the users' foreign billing currencies. */
  rateOn: RateLookup;
};

/** Outflows as positive charges, grouped by merchant. */
export function chargesByMerchant(txs: readonly TransactionRow[]): Map<string, ChargeTx[]> {
  const m = new Map<string, ChargeTx[]>();
  for (const t of txs) {
    if (!t.merchant_id || !(t.amount < 0)) continue;
    const list = m.get(t.merchant_id) ?? [];
    list.push({
      id: t.id,
      date: t.posted_at,
      amount: -t.amount,
      originalAmount: t.original_amount === null ? null : Math.abs(t.original_amount),
      originalCurrency: t.original_currency,
      origin: t.origin,
    });
    m.set(t.merchant_id, list);
  }
  return m;
}

function usageFor(row: SubscriptionRow, signals: readonly UsageSignalRow[]): SubscriptionItem["usage"] {
  const mine = signals.filter((s) => s.subscription_id === row.id || (!s.subscription_id && s.merchant_id === row.merchant_id));
  if (mine.length === 0) return null;
  const perMonthRow = mine.find((s) => s.metric === USAGE_METRICS.perMonth && s.value !== null);
  const sessions = perMonthRow ?? mine.find((s) => s.metric === USAGE_METRICS.sessions && s.value !== null);
  const lastUsed = mine
    .filter((s) => s.metric === USAGE_METRICS.lastUsed && s.period_end)
    .map((s) => s.period_end as string)
    .sort()
    .pop();
  let perMonth: number | null = null;
  if (perMonthRow && perMonthRow.value !== null) {
    perMonth = perMonthRow.value;
  } else if (sessions && sessions.value !== null) {
    const days = sessions.period_start && sessions.period_end ? daysBetween(sessions.period_start, sessions.period_end) + 1 : 30;
    perMonth = Math.round(((sessions.value * 30) / Math.max(1, days)) * 10) / 10;
  }
  const src = sessions ?? mine[0];
  return {
    lastUsedAt: lastUsed ?? null,
    sessionsPerMonth: perMonth,
    source: { origin: src.origin, sourceId: src.source ?? undefined, simulated: src.simulated },
  };
}

export async function loadSubscriptionContext(d: ViewDeps, status?: string | null): Promise<SubscriptionContext> {
  const day = today(d);
  const [settings, rows, usage, txs] = await Promise.all([
    d.repos.settings(d.userId),
    d.repos.subscriptions(d.userId, status),
    d.repos.usageSignals(d.userId),
    d.repos.transactions(d.userId, { from: addDays(day, -DETECTION_LOOKBACK_DAYS), to: day }),
  ]);
  const base = settings.baseCurrency;
  const rate = rateLookupFor(d);

  // Current and historical rates for each foreign billing currency.
  const foreign = [...new Set(rows.map((r) => r.billing_currency).filter((c): c is string => !!c && c !== base))];
  const current = new Map<string, RateInfo | null>();
  const history = new Map<string, { date: string; rate: number }[]>();
  for (const cur of foreign) {
    current.set(cur, await rate(cur, base, day));
    const hist = await d.repos.fxRates(d.userId, cur, base, addDays(day, -DETECTION_LOOKBACK_DAYS), day);
    history.set(cur, hist.map((h) => ({ date: h.date, rate: h.rate })));
  }
  const rateOn: RateLookup = (cur, date) => {
    const h = history.get(cur);
    if (!h) return null;
    const dd = date.slice(0, 10);
    let best: { date: string; rate: number } | null = null;
    for (const r of h) if (r.date <= dd && daysBetween(r.date, dd) <= 7) best = r;
    return best;
  };

  const charges = chargesByMerchant(txs);
  const subs: EnrichedSubscription[] = rows.map((row) => {
    const group = charges.get(row.merchant_id) ?? [];
    const detection = detectRecurring(group, {
      baseCurrency: base,
      candidateCurrencies: row.billing_currency ? [row.billing_currency] : [],
      rateOn,
    });
    const isForeign = !!row.billing_currency && row.billing_currency !== base && row.original_amount !== null;
    const fx = isForeign ? (current.get(row.billing_currency as string) ?? null) : null;
    const fxQuote = fx ? { rate: fx.rate, rateDate: fx.rateDate } : null;
    const amount = isForeign
      ? fxMoney(row.original_amount as number, row.billing_currency as string, base, fxQuote)
      : { amount: row.amount, currency: row.currency };
    const savings =
      computeSavings({ amount: amount.amount, currency: amount.currency, cycleDays: row.cycle_days, baseCurrency: base, fx: fxQuote }) ??
      (row.currency === base
        ? computeSavings({ amount: row.amount, currency: base, cycleDays: row.cycle_days, baseCurrency: base, fx: null })
        : null);
    const trialEndDay = row.trial_end ? row.trial_end.slice(0, 10) : null;
    const firstPaid = trialEndDay
      ? (group.map((c) => c.date.slice(0, 10)).filter((x) => x >= trialEndDay).sort()[0] ?? null)
      : null;
    const pc = detection?.priceChange;
    const item: SubscriptionItem = {
      id: row.id,
      merchant: { id: row.merchant_id, name: row.merchant_name ?? row.merchant_id, category: row.category ?? "uncategorized" },
      status: row.status,
      cycleDays: row.cycle_days,
      amount,
      nextRenewal: row.next_renewal,
      trial: row.trial_end
        ? {
            endsAt: trialEndDay as string,
            autoCancelAt:
              settings.autoCancelTrials && !row.keep_flag && row.status === "trial"
                ? addDays(trialEndDay as string, -settings.autoCancelTrials.daysBeforeCharge)
                : null,
            keepFlag: row.keep_flag,
            origin: row.trial_status_origin ?? DETECTION_ORIGIN[row.detection_source],
          }
        : null,
      priceChange: pc
        ? { from: { amount: pc.from, currency: detection!.currency }, to: { amount: pc.to, currency: detection!.currency }, at: pc.at }
        : null,
      usage: usageFor(row, usage),
      annualCost: savings ? savings.annualBase : { amount: 0, currency: base },
      confidence: row.confidence ?? detection?.confidence ?? 1,
      detectionSource: row.detection_source,
    };
    const fxCost =
      isForeign && fxQuote
        ? fxCostEstimate({
            originalAmount: row.original_amount as number,
            originalCurrency: row.billing_currency as string,
            baseCurrency: base,
            cycleDays: row.cycle_days,
            fx: fxQuote,
          })
        : null;
    return { row, item, monthlyBase: savings ? savings.monthlyBase.amount : null, fx, detection, firstPaidChargeAt: firstPaid, fxCost };
  });
  return { settings, baseCurrency: base, subs, transactions: txs, rateOn };
}

export async function buildSubscriptions(d: ViewDeps, status?: string | null): Promise<SubscriptionsResponse> {
  const ctx = await loadSubscriptionContext(d, status);
  return { baseCurrency: ctx.baseCurrency, items: ctx.subs.map((s) => s.item) };
}

/** `compute_savings`: annual cost of one subscription in the base currency (FR5.8). */
export async function buildSavings(d: ViewDeps, subscriptionId: string) {
  const ctx = await loadSubscriptionContext(d);
  const s = ctx.subs.find((x) => x.row.id === subscriptionId);
  if (!s) return null;
  return {
    subscriptionId,
    name: s.item.merchant.name,
    perCycle: s.item.amount,
    cycleDays: s.item.cycleDays,
    annualSavings: s.item.annualCost,
    monthlyBase: s.monthlyBase === null ? null : { amount: s.monthlyBase, currency: ctx.baseCurrency },
    fx: s.fx ? { rate: s.fx.rate, rateDate: s.fx.rateDate, stale: s.fx.stale } : null,
    origin: DETECTION_ORIGIN[s.row.detection_source],
  };
}

// ---- Recommendations --------------------------------------------------------------------

function toRecSubscription(s: EnrichedSubscription): RecSubscription {
  return {
    id: s.row.id,
    name: s.item.merchant.name,
    category: s.item.merchant.category,
    status: s.row.status,
    cycleDays: s.row.cycle_days,
    monthlyBase: s.monthlyBase ?? 0,
    source: { origin: DETECTION_ORIGIN[s.row.detection_source] },
    priceChange: s.item.priceChange,
    trial: s.item.trial ? { endsAt: s.item.trial.endsAt, origin: s.item.trial.origin } : null,
    firstPaidChargeAt: s.firstPaidChargeAt,
    usage: s.item.usage ? { sessionsPerMonth: s.item.usage.sessionsPerMonth, source: s.item.usage.source } : null,
    fxCost: s.fxCost ? { annual: s.fxCost.annualFxCost, rateDate: s.fxCost.rateDate } : null,
  };
}

/** Outflows over the last 30 days, the denominator of `high_share`. */
function monthlySpending(txs: readonly TransactionRow[], now: string, base: string): number {
  const from = addDays(now.slice(0, 10), -30);
  return txs.filter((t) => t.amount < 0 && t.currency === base && t.posted_at.slice(0, 10) > from).reduce((a, t) => a - t.amount, 0);
}

/** Live scores (used by cron/detect to write `recommendations`). */
export async function scoreRecommendations(d: ViewDeps) {
  const ctx = await loadSubscriptionContext(d);
  const ranked = rankRecommendations(ctx.subs.map(toRecSubscription), {
    monthlySpending: monthlySpending(ctx.transactions, d.now, ctx.baseCurrency),
    baseCurrency: ctx.baseCurrency,
    now: d.now,
  });
  return { ctx, ranked };
}

export async function buildRecommendations(d: ViewDeps): Promise<RecommendationsResponse> {
  const [rows, ctx] = await Promise.all([d.repos.recommendations(d.userId), loadSubscriptionContext(d)]);
  const byId = new Map(ctx.subs.map((s) => [s.row.id, s]));
  return {
    items: rows.flatMap((r) => {
      const s = byId.get(r.subscription_id);
      if (!s) return [];
      return [
        {
          id: r.id,
          subscriptionId: r.subscription_id,
          score: r.score,
          signals: r.signals_json,
          annualSavings: s.item.annualCost,
          status: r.status,
        },
      ];
    }),
  };
}

// ---- Summary ----------------------------------------------------------------------------

export async function buildSummary(d: ViewDeps, period: string): Promise<SummaryResponse> {
  const { from, toExclusive } = periodBounds(period);
  const prev = periodBounds(previousPeriod(period));
  const [ctx, accounts, bills, txs] = await Promise.all([
    loadSubscriptionContext(d),
    d.repos.accounts(d.userId),
    d.repos.bills(d.userId),
    d.repos.transactions(d.userId, { from: prev.from, to: addDays(toExclusive, -1) }),
  ]);
  const base = ctx.baseCurrency;
  const inBase = txs.filter((t) => t.currency === base);
  // For the current month, compare with the same days of last month, not the whole month.
  const day = today(d);
  const monthToDate = day >= from && day < toExclusive;
  const prevEnd = monthToDate ? addDays(prev.from, daysBetween(from, day) + 1) : from;
  const prevOut = inBase.filter(
    (t) => t.amount < 0 && t.posted_at.slice(0, 10) >= prev.from && t.posted_at.slice(0, 10) < (prevEnd < from ? prevEnd : from),
  );
  return computeSummary({
    period,
    baseCurrency: base,
    now: d.now,
    balance: accounts.filter((a) => a.currency === base).reduce((a, x) => a + x.balance, 0),
    transactions: inBase.map((t) => ({ id: t.id, date: t.posted_at, amountBase: t.amount, category: t.category })),
    previousPeriodSpending: prevOut.length ? prevOut.reduce((a, t) => a - t.amount, 0) : null,
    previousComparison: monthToDate ? "month_to_date" : "full_month",
    bills: bills.map((b) => ({ id: b.id, title: b.biller_name ?? b.biller_id, dueDate: b.due_date, amount: b.amount, status: b.status })),
    subscriptions: ctx.subs.map((s) => ({
      id: s.row.id,
      title: s.item.merchant.name,
      status: s.row.status,
      amount: s.item.amount,
      monthlyBase: s.monthlyBase,
      nextRenewal: s.row.next_renewal,
      trial: s.item.trial ? { endsAt: s.item.trial.endsAt, keepFlag: s.item.trial.keepFlag } : null,
      priceChange: s.item.priceChange,
    })),
  });
}

// ---- Prepaid ----------------------------------------------------------------------------

const LEVEL_ORDER: Record<RiskLevel, number> = { none: 0, watch: 1, elevated: 2 };
const maxLevel = (a: RiskLevel, b: RiskLevel): RiskLevel => (LEVEL_ORDER[b] > LEVEL_ORDER[a] ? b : a);

export function hardSignal(a: AttestationRow): PrepaidSignal {
  return {
    tier: "hard",
    kind: a.kind,
    summary: a.sig_valid
      ? `Signed ${a.kind.replace("_", " ")} attestation from the registry (case ${a.case_ref_hash.slice(0, 10)}).`
      : `Rejected ${a.kind.replace("_", " ")} attestation: the signature does not verify.`,
    observedAt: a.issued_at,
    // Origin oracle only when the signature verifies (architecture §10.1); registry is simulated in v1.
    source: { origin: a.sig_valid ? "oracle" : "web", sourceId: a.id, simulated: true },
  };
}

export function softSignal(r: RiskSignalRow): PrepaidSignal {
  return {
    tier: "soft",
    kind: r.kind,
    level: r.level,
    summary: r.summary ?? `${r.kind} level ${r.level}`,
    observedAt: r.observed_at,
    source: { origin: r.origin, sourceId: r.source_ids[0] ?? r.id, simulated: r.simulated },
  };
}

/**
 * Merchant risk for display and the advisor: the stored level, raised by recent soft signals
 * and by any valid, unexpired attestation. Soft signals only ever warn (PRD §15.12).
 */
export function merchantRiskLevel(stored: RiskLevel, soft: readonly RiskSignalRow[], hard: readonly AttestationRow[], now: string): RiskLevel {
  let level = stored;
  for (const s of soft) {
    if (daysBetween(s.observed_at, now) <= SOFT_SIGNAL_WINDOW_DAYS) level = maxLevel(level, s.level);
  }
  if (hard.some((a) => a.sig_valid && a.expires_at > now)) level = "elevated";
  return level;
}

export async function buildPrepaidPlans(d: ViewDeps): Promise<PrepaidPlansResponse> {
  const [settings, plans, sessions] = await Promise.all([
    d.repos.settings(d.userId),
    d.repos.prepaidPlans(d.userId),
    d.repos.prepaidSessions(d.userId),
  ]);
  const merchants = [...new Set(plans.map((p) => p.merchant_id))];
  const [atts, soft] = await Promise.all([d.repos.attestations(d.userId, merchants), d.repos.riskSignals(d.userId, merchants)]);
  const cur = settings.baseCurrency;
  const items: PrepaidPlanItem[] = plans.map((p) => {
    const mSoft = soft.filter((s) => s.merchant_id === p.merchant_id);
    const mHard = atts.filter((a) => a.merchant_id === p.merchant_id);
    const unit = fenToYuan(p.unit_price);
    const left = p.units_total - p.units_redeemed;
    return {
      id: p.id,
      chainPlanId: p.chain_plan_id,
      merchant: { id: p.merchant_id, name: p.merchant_name ?? p.merchant_id, riskLevel: merchantRiskLevel(p.merchant_risk_level, mSoft, mHard, d.now) },
      unitPrice: { amount: unit, currency: cur },
      unitsTotal: p.units_total,
      unitsRedeemed: p.units_redeemed,
      balanceInEscrow: { amount: p.status === "active" ? roundBase(unit * left) : 0, currency: cur },
      cancelFeeBps: p.cancel_fee_bps,
      status: p.status,
      purchaseTx: chainTxRef(p.purchase_tx),
      sessions: sessions
        .filter((s) => s.plan_id === p.id)
        .map((s) => ({ sessionNo: s.session_no, redeemedAt: s.redeemed_at, tx: chainTxRef(s.tx_hash) })),
      signals: [...mHard.map(hardSignal), ...mSoft.map(softSignal)],
      testTokenNotice: TEST_TOKEN_NOTICE,
    };
  });
  return { baseCurrency: cur, plans: items };
}

function offerItem(o: PrepaidOfferRow, cur: string, soft: RiskSignalRow[], hard: AttestationRow[], now: string): PrepaidOfferItem | null {
  const ppv = o.pay_per_visit_price ?? o.offer_json.payPerVisitPrice;
  if (ppv === undefined || !(ppv > 0)) return null; // the advisor needs q; skip malformed offers
  const unit = fenToYuan(o.unit_price);
  return {
    id: o.id,
    merchant: {
      id: o.merchant_id,
      name: o.merchant_name ?? o.offer_json.merchantName ?? o.merchant_id,
      escrowSupported: o.escrow_supported,
      riskLevel: merchantRiskLevel(o.merchant_risk_level, soft, hard, now),
    },
    unitPrice: { amount: unit, currency: cur },
    units: o.units,
    total: { amount: roundBase(unit * o.units), currency: cur },
    payPerVisitPrice: { amount: fenToYuan(ppv), currency: cur },
    cancelFeeBps: o.cancel_fee_bps,
    expiresAt: o.expires_at,
    signals: [...hard.map(hardSignal), ...soft.map(softSignal)],
    simulated: true,
  };
}

async function signalsFor(d: ViewDeps, merchantIds: string[]) {
  const [atts, soft] = await Promise.all([d.repos.attestations(d.userId, merchantIds), d.repos.riskSignals(d.userId, merchantIds)]);
  return {
    hard: (m: string) => atts.filter((a) => a.merchant_id === m),
    soft: (m: string) => soft.filter((s) => s.merchant_id === m),
  };
}

export async function buildPrepaidOffers(d: ViewDeps): Promise<PrepaidOffersResponse> {
  const [settings, offers] = await Promise.all([d.repos.settings(d.userId), d.repos.prepaidOffers(d.userId, d.now)]);
  const sig = await signalsFor(d, [...new Set(offers.map((o) => o.merchant_id))]);
  return {
    offers: offers
      .map((o) => offerItem(o, settings.baseCurrency, sig.soft(o.merchant_id), sig.hard(o.merchant_id), d.now))
      .filter((x): x is PrepaidOfferItem => x !== null),
  };
}

export const CLOSURE_RATE_NOTES: Record<PrepaidAdviceResponse["closureRate"]["source"], string> = {
  default: "Default annual closure rate for gyms (2022 figure, PRD §2.2.1) [verify primary source].",
  input: "Closure rate provided as input.",
  elevated_signal: "Raised ×3 because this merchant's soft-signal level is elevated (warning only; never triggers an exit).",
};

export type AdviceOptions = { expectedSessions?: number; periodMonths?: number };

/** PRD §15.11 via `advisePrepaid`; every number in the response comes from it. */
export async function buildAdvice(
  d: ViewDeps,
  offerId: string,
  opts: AdviceOptions = {},
): Promise<{ advice: PrepaidAdviceResponse; offer: PrepaidOfferItem } | null> {
  const [settings, o] = await Promise.all([d.repos.settings(d.userId), d.repos.prepaidOffer(d.userId, offerId)]);
  if (!o) return null;
  const sig = await signalsFor(d, [o.merchant_id]);
  const offer = offerItem(o, settings.baseCurrency, sig.soft(o.merchant_id), sig.hard(o.merchant_id), d.now);
  if (!offer) return null;
  const r = advisePrepaid({
    packagePrice: offer.total.amount,
    sessions: offer.units,
    payPerVisitPrice: offer.payPerVisitPrice.amount,
    expectedSessions: opts.expectedSessions,
    periodMonths: opts.periodMonths,
    escrowAvailable: offer.merchant.escrowSupported,
    riskLevel: offer.merchant.riskLevel,
  });
  const money = (amount: number): Money => ({ amount, currency: settings.baseCurrency });
  return {
    offer,
    advice: {
      offerId,
      savings: money(r.savings),
      breakEvenSessions: r.breakEvenSessions,
      expectedSessions: opts.expectedSessions ?? offer.units,
      closureRate: { value: r.closureRateUsed, source: r.closureRateSource, note: CLOSURE_RATE_NOTES[r.closureRateSource] },
      periodClosureProbability: r.periodClosureProbability,
      expectedLossWithoutEscrow: money(r.expectedLossWithoutEscrow),
      expectedLossWithEscrow: money(r.expectedLossWithEscrow),
      escrowAvailable: offer.merchant.escrowSupported,
      recommendation: r.recommendation,
    },
  };
}

/** `list_risk_signals(merchant_id)`: hard and soft signals with origins. */
export async function buildRiskSignals(d: ViewDeps, merchantId: string) {
  const sig = await signalsFor(d, [merchantId]);
  const hard = sig.hard(merchantId);
  const soft = sig.soft(merchantId);
  return {
    merchantId,
    level: merchantRiskLevel("none", soft, hard, d.now),
    hard: hard.map((a) => ({ ...hardSignal(a), signer: a.signer, sigValid: a.sig_valid, expiresAt: a.expires_at })),
    soft: soft.map(softSignal),
    note: "Soft signals can only warn; only a valid oracle attestation can support an exit.",
  };
}

