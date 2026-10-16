// Money shapes and formatting shared by read-side algorithms. Pure.
// Structurally identical to `Money` / `FxMoney` / `SourceRef` in src/server/api-types.ts (core may
// not import server code), so values flow into API responses without mapping.

import type { Origin } from "@/src/core/types";

export type Money = { amount: number; currency: string };
export type FxMoney = Money & { base?: Money & { rate: number; rateDate: string } };
export type SourceRef = { origin: Origin; sourceId?: string; simulated?: boolean };
export type FxQuote = { rate: number; rateDate: string };

/** Base-currency amounts in API responses are whole units (yuan for Lin). */
export const roundBase = (x: number) => Math.round(x);

const SYMBOLS: Record<string, string> = { CNY: "¥", USD: "$", EUR: "€", IDR: "Rp" };

/** Deterministic display string used in code-written insight and signal texts. */
export function fmt(m: Money): string {
  const sym = SYMBOLS[m.currency];
  const n = Number.isInteger(m.amount)
    ? m.amount.toLocaleString("en-US")
    : m.amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return sym ? `${sym}${n}` : `${m.currency} ${n}`;
}

/** Foreign amount with its base equivalent at `fx` (FR18.4); same currency → no `base`. */
export function fxMoney(amount: number, currency: string, baseCurrency: string, fx: FxQuote | null): FxMoney {
  if (currency === baseCurrency || !fx) return { amount, currency };
  return {
    amount,
    currency,
    base: { amount: roundBase(amount * fx.rate), currency: baseCurrency, rate: fx.rate, rateDate: fx.rateDate },
  };
}

/** Base-currency value of an FxMoney, or null if a foreign amount has no rate. */
export function baseAmountOf(m: FxMoney, baseCurrency: string): number | null {
  if (m.currency === baseCurrency) return m.amount;
  return m.base ? m.base.amount : null;
}
