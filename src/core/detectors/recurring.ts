// Recurring-charge detection with FX normalization (PRD §15.1, FR18.3). Pure: callers pass the
// transactions, a rate lookup and `now`.
//
// Base rule: ≥ 3 charges, gaps near 7, 30 or 365 days (± 3), amount spread ≤ 10% of the median.
// Extensions implemented here:
// - one missed cycle: at most one gap of ≈ 2 cycles (± 3) is allowed;
// - price change: the amount may step to a new stable regime with the same cadence; every regime
//   except the latest needs ≥ 2 charges, so a single odd charge is not a "regime";
// - FX: if `originalCurrency` is known, stability is tested on `originalAmount`; otherwise each
//   base amount is converted back to a suspected billing currency at its posting-date rate.

import { addDays, daysBetween, median, relativeSpread, round2, toDay } from "./stats";

export const CYCLES = [7, 30, 365] as const;
export type CycleDays = (typeof CYCLES)[number];
export const GAP_TOLERANCE_DAYS = 3;
export const AMOUNT_TOLERANCE = 0.1;

export type ChargeTx = {
  id: string;
  date: string; // posting date (YYYY-MM-DD or ISO)
  amount: number; // positive charge in the account (base) currency
  originalAmount?: number | null;
  originalCurrency?: string | null;
  /** Origin of the source transaction (public.transactions.origin). */
  origin?: string;
};

/** Base-currency units per 1 unit of `currency` on `date`, or null if unknown. */
export type RateLookup = (currency: string, date: string) => { rate: number; date: string } | null;

export type Regime = { from: string; amount: number; txIds: string[] };

export type RecurringResult = {
  cycleDays: CycleDays;
  currency: string; // billing currency the stability test ran on
  normalizedBy: "original_amount" | "fx_rate" | "none";
  amount: number; // median of the latest regime, in `currency`
  regimes: Regime[];
  priceChange: { from: number; to: number; at: string } | null;
  missedCycles: number;
  firstSeen: string;
  lastCharged: string;
  nextExpected: string;
  txIds: string[];
  confidence: number;
};

export type DetectOptions = {
  baseCurrency: string;
  /** Suspected billing currencies (merchant hint) to try when no original currency is stored. */
  candidateCurrencies?: readonly string[];
  rateOn?: RateLookup;
};

type Point = { id: string; date: string; value: number };

/** Classifies each gap against one cycle; null if any gap fits neither 1× nor 2× the cycle. */
function cadence(gaps: number[], cycle: number): { missed: number } | null {
  let missed = 0;
  for (const g of gaps) {
    if (Math.abs(g - cycle) <= GAP_TOLERANCE_DAYS) continue;
    if (Math.abs(g - 2 * cycle) <= GAP_TOLERANCE_DAYS) {
      missed++;
      continue;
    }
    return null;
  }
  return missed <= 1 ? { missed } : null;
}

/** Greedy split into amount regimes; null if the sequence is not "stable with ≤ steps". */
export function splitRegimes(points: readonly Point[]): Regime[] | null {
  const regimes: { from: string; values: number[]; ids: string[] }[] = [];
  for (const p of points) {
    const cur = regimes[regimes.length - 1];
    if (cur && relativeSpread([...cur.values, p.value]) <= AMOUNT_TOLERANCE + 1e-12) {
      cur.values.push(p.value);
      cur.ids.push(p.id);
    } else {
      regimes.push({ from: toDay(p.date), values: [p.value], ids: [p.id] });
    }
  }
  if (regimes.slice(0, -1).some((r) => r.values.length < 2)) return null;
  return regimes.map((r) => ({ from: r.from, amount: round2(median(r.values)), txIds: r.ids }));
}

function confidenceOf(n: number, missed: number, regimes: number): number {
  const c = 0.5 + 0.1 * Math.min(n, 5) - 0.1 * missed - 0.05 * (regimes - 1);
  return round2(Math.max(0.1, Math.min(0.99, c)));
}

function detectOn(points: Point[], currency: string, normalizedBy: RecurringResult["normalizedBy"]): RecurringResult | null {
  if (points.length < 3) return null;
  if (points.some((p) => !(p.value > 0))) return null;
  const gaps = points.slice(1).map((p, i) => daysBetween(points[i].date, p.date));
  for (const cycle of CYCLES) {
    const c = cadence(gaps, cycle);
    if (!c) continue;
    const regimes = splitRegimes(points);
    if (!regimes) continue;
    const last = regimes[regimes.length - 1];
    const prev = regimes.length > 1 ? regimes[regimes.length - 2] : null;
    const lastCharged = toDay(points[points.length - 1].date);
    return {
      cycleDays: cycle,
      currency,
      normalizedBy,
      amount: last.amount,
      regimes,
      priceChange: prev ? { from: prev.amount, to: last.amount, at: last.from } : null,
      missedCycles: c.missed,
      firstSeen: toDay(points[0].date),
      lastCharged,
      nextExpected: addDays(lastCharged, cycle),
      txIds: points.map((p) => p.id),
      confidence: confidenceOf(points.length, c.missed, regimes.length),
    };
  }
  return null;
}

/**
 * Converts base amounts back to `currency` at each posting-date rate. Returns null if any rate is
 * missing. Also used before anomaly checks (PRD §15.1 "same normalization").
 */
export function normalizeAmounts(
  txs: readonly ChargeTx[],
  currency: string,
  rateOn: RateLookup,
): number[] | null {
  const out: number[] = [];
  for (const t of txs) {
    if (t.originalCurrency === currency && t.originalAmount != null) {
      out.push(t.originalAmount);
      continue;
    }
    const r = rateOn(currency, t.date);
    if (!r || !(r.rate > 0)) return null;
    out.push(t.amount / r.rate);
  }
  return out;
}

/** Detects one merchant's recurring charge. `txs` may be unsorted. */
export function detectRecurring(txs: readonly ChargeTx[], opts: DetectOptions): RecurringResult | null {
  if (txs.length < 3) return null;
  const sorted = [...txs].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

  // 1. Original currency known on every charge: test stability there.
  const orig = sorted[0].originalCurrency;
  if (orig && sorted.every((t) => t.originalCurrency === orig && t.originalAmount != null)) {
    const pts = sorted.map((t) => ({ id: t.id, date: t.date, value: t.originalAmount as number }));
    const r = detectOn(pts, orig, orig === opts.baseCurrency ? "none" : "original_amount");
    if (r) return r;
  }

  // 2. Suspected foreign billing currency (merchant hint), normalized by the posting-date rate.
  //    Tried before base amounts so a USD plan keeps its billing currency even when the base
  //    amounts happen to pass the 10% test.
  if (opts.rateOn) {
    for (const cur of opts.candidateCurrencies ?? []) {
      if (cur === opts.baseCurrency) continue;
      const vals = normalizeAmounts(sorted, cur, opts.rateOn);
      if (!vals) continue;
      const r = detectOn(
        sorted.map((t, i) => ({ id: t.id, date: t.date, value: round2(vals[i]) })),
        cur,
        "fx_rate",
      );
      if (r) return r;
    }
  }
  // 3. Base amounts as charged.
  const base = detectOn(
    sorted.map((t) => ({ id: t.id, date: t.date, value: t.amount })),
    opts.baseCurrency,
    "none",
  );
  if (base) return base;

  return null;
}

/** FR5.4: no charge within one cycle plus tolerance → inactive. */
export function recurringStatus(lastCharged: string, cycleDays: number, now: string): "active" | "inactive" {
  return daysBetween(lastCharged, now) > cycleDays + GAP_TOLERANCE_DAYS ? "inactive" : "active";
}

export type MerchantCharges = { merchantId: string; txs: ChargeTx[] };

/** Groups outflow transactions by normalized merchant id (rows without a merchant are skipped). */
export function groupByMerchant<T extends ChargeTx & { merchantId: string | null }>(txs: readonly T[]): MerchantCharges[] {
  const m = new Map<string, ChargeTx[]>();
  for (const t of txs) {
    if (!t.merchantId) continue;
    const list = m.get(t.merchantId) ?? [];
    list.push(t);
    m.set(t.merchantId, list);
  }
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([merchantId, list]) => ({ merchantId, txs: list }));
}
