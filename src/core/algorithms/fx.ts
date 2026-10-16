// FX cost estimate (PRD §15.10, FR18.5) and annual savings (FR5.8, tool `compute_savings`). Pure.

import { round2 } from "@/src/core/detectors/stats";
import { type FxQuote, roundBase } from "./money";

/** Card FX markup default [verify typical values per card/bank, PRD §15.10]. */
export const DEFAULT_FX_MARKUP_PCT = 0.015;

/** Weekly → 52, monthly → 12, yearly → 1; any other cycle → 365 / cycleDays. */
export function cyclesPerYear(cycleDays: number): number {
  if (!(cycleDays > 0)) throw new RangeError("cycleDays must be positive");
  if (cycleDays === 7) return 52;
  if (cycleDays >= 28 && cycleDays <= 31) return 12;
  if (cycleDays >= 365 && cycleDays <= 366) return 1;
  return round2(365 / cycleDays);
}

export type FxCostInput = {
  originalAmount: number;
  originalCurrency: string;
  baseCurrency: string;
  cycleDays: number;
  fx: FxQuote; // base units per 1 original unit
  markupPct?: number;
};

export type FxCostResult = {
  annualFxCost: number; // base currency, 2 decimals
  annualBase: number; // base currency, whole units
  cyclesPerYear: number;
  markupPct: number;
  rate: number;
  rateDate: string;
  assumptions: string[];
};

/** `annual_fx_cost = original_amount × cycles_per_year × rate × markup_pct`. */
export function fxCostEstimate(input: FxCostInput): FxCostResult | null {
  if (input.originalCurrency === input.baseCurrency) return null;
  if (!(input.fx.rate > 0) || !(input.originalAmount >= 0)) throw new RangeError("fxCostEstimate: bad input");
  const markup = input.markupPct ?? DEFAULT_FX_MARKUP_PCT;
  const cpy = cyclesPerYear(input.cycleDays);
  const annualBaseRaw = input.originalAmount * cpy * input.fx.rate;
  return {
    annualFxCost: round2(annualBaseRaw * markup),
    annualBase: roundBase(annualBaseRaw),
    cyclesPerYear: cpy,
    markupPct: markup,
    rate: input.fx.rate,
    rateDate: input.fx.rateDate,
    assumptions: [
      `ECB reference rate ${input.fx.rate} ${input.baseCurrency}/${input.originalCurrency} on ${input.fx.rateDate}`,
      `card markup ${round2(markup * 100)}% (configurable, not verified per card)`,
    ],
  };
}

export type SavingsInput = {
  amount: number; // per cycle, in `currency`
  currency: string;
  cycleDays: number;
  baseCurrency: string;
  fx: FxQuote | null; // required when currency ≠ baseCurrency
};

export type SavingsResult = {
  cyclesPerYear: number;
  annualOriginal: { amount: number; currency: string };
  annualBase: { amount: number; currency: string };
  monthlyBase: { amount: number; currency: string };
  fx: FxQuote | null;
};

/** Annual cost (= savings if cancelled) in the base currency; null if a needed rate is missing. */
export function computeSavings(input: SavingsInput): SavingsResult | null {
  if (!(input.amount >= 0)) throw new RangeError("computeSavings: amount must be ≥ 0");
  const foreign = input.currency !== input.baseCurrency;
  if (foreign && !input.fx) return null;
  const rate = foreign ? (input.fx as FxQuote).rate : 1;
  const cpy = cyclesPerYear(input.cycleDays);
  const annualOrig = input.amount * cpy;
  return {
    cyclesPerYear: cpy,
    annualOriginal: { amount: round2(annualOrig), currency: input.currency },
    annualBase: { amount: roundBase(annualOrig * rate), currency: input.baseCurrency },
    monthlyBase: { amount: roundBase((annualOrig * rate) / 12), currency: input.baseCurrency },
    fx: foreign ? input.fx : null,
  };
}
