// Display formatting. Pure: callers pass `now` where a relative date is needed.
// Amounts arrive as numbers in major units (yuan, dollars); see src/server/api-types.ts.

export type MoneyLike = { amount: number; currency: string };

const SYMBOLS: Record<string, string> = { CNY: "¥", USD: "$", IDR: "Rp", EUR: "€" };

export function currencySymbol(currency: string): string {
  return SYMBOLS[currency] ?? `${currency} `;
}

/** "¥4,800.00" split so the decimals can be drawn lighter. */
export function moneyParts(m: MoneyLike, opts: { decimals?: boolean } = {}) {
  const decimals = opts.decimals ?? true;
  const abs = Math.abs(m.amount);
  const fixed = abs.toFixed(decimals ? 2 : 0);
  const [whole, frac] = fixed.split(".");
  return {
    sign: m.amount < 0 ? "-" : "",
    symbol: currencySymbol(m.currency),
    whole: Number(whole).toLocaleString("en-US"),
    frac: frac ? `.${frac}` : "",
  };
}

export function formatMoney(m: MoneyLike, opts: { decimals?: boolean } = {}): string {
  const p = moneyParts(m, opts);
  return `${p.sign}${p.symbol}${p.whole}${p.frac}`;
}

const DAY = 86_400_000;

function dayStart(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Whole days from `now` to `iso` (negative = past). Date-only strings count as UTC days. */
export function daysFrom(iso: string, now: Date): number {
  return Math.round((dayStart(new Date(iso)) - dayStart(now)) / DAY);
}

/** "Tue 20 Oct" */
export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

/** "20 Oct" */
export function dayMonth(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** "20 Oct, 14:05" in Asia/Shanghai (the demo user's zone). */
export function dateTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Shanghai" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Shanghai" });
  return `${date}, ${time}`;
}

/** Group header for a list: "Today", "Tomorrow", "Yesterday" or "Tue 20 Oct". */
export function dayLabel(iso: string, now: Date): string {
  const n = daysFrom(iso, now);
  if (n === 0) return "Today";
  if (n === 1) return "Tomorrow";
  if (n === -1) return "Yesterday";
  return shortDate(iso);
}

/** "in 3 days", "today", "2 days ago". */
export function relativeDays(iso: string, now: Date): string {
  const n = daysFrom(iso, now);
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

/** "in 23 h" / "in 40 min" / "expired". */
export function expiresIn(iso: string, now: Date): string {
  const ms = new Date(iso).getTime() - now.getTime();
  if (ms <= 0) return "expired";
  const min = Math.round(ms / 60_000);
  if (min < 60) return `in ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `in ${h} h`;
  return `in ${Math.round(h / 24)} days`;
}

/** "0x5e1f…0001" */
export function shortHash(hash: string): string {
  return hash.length > 12 ? `${hash.slice(0, 6)}…${hash.slice(-4)}` : hash;
}

/** "food_delivery" -> "Food delivery" */
export function humanize(key: string): string {
  const s = key.replaceAll("_", " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
