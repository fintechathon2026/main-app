// Display formatting only. Every number shown comes from an API field; nothing is computed here
// except presentation (G6: the LLM never computes the numbers users see, and neither does the UI).

import type { FxMoney, Money, SourceRef } from "@/src/server/api-types";

const SYMBOLS: Record<string, string> = { CNY: "¥", USD: "$", IDR: "Rp", EUR: "€" };

export function money(m: Money | null | undefined, opts?: { decimals?: number }): string {
  if (!m) return "—";
  const decimals = opts?.decimals ?? (Number.isInteger(m.amount) ? 0 : 2);
  const n = m.amount.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const sym = SYMBOLS[m.currency];
  return sym ? `${sym}${n}` : `${n} ${m.currency}`;
}

/** Foreign amounts show the base-currency equivalent and rate date (PRD FR18.4). */
export function fxNote(m: FxMoney): string | null {
  if (!m.base) return null;
  return `≈ ${money(m.base)} at ${m.base.rate} (${m.base.rateDate})`;
}

export function date(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function shortHash(h: string): string {
  return h.length > 14 ? `${h.slice(0, 8)}…${h.slice(-4)}` : h;
}

const ORIGIN_LABELS: Record<string, string> = {
  mock_bank: "bank",
  merchant_api: "merchant",
  document: "document",
  web: "web",
  user: "you",
  fx_provider: "FX rate",
  chain: "chain",
  oracle: "registry",
  simulated: "simulated",
};

export function sourceLabel(s: SourceRef): string {
  return ORIGIN_LABELS[s.origin] ?? s.origin;
}

export function pct(bps: number): string {
  return `${bps / 100}%`;
}
