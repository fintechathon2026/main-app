// Small numeric and calendar helpers shared by detectors and algorithms. Pure: no clock.

export function median(xs: readonly number[]): number {
  if (xs.length === 0) throw new RangeError("median of empty list");
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Median absolute deviation (unscaled). */
export function mad(xs: readonly number[]): number {
  const m = median(xs);
  return median(xs.map((x) => Math.abs(x - m)));
}

/** Relative spread (max − min) / median, the amount-stability test of PRD §15.1. */
export function relativeSpread(xs: readonly number[]): number {
  const m = median(xs);
  if (m === 0) return xs.every((x) => x === 0) ? 0 : Infinity;
  return (Math.max(...xs) - Math.min(...xs)) / Math.abs(m);
}

export const round2 = (x: number) => Math.round(x * 100) / 100;

const DAY_MS = 86_400_000;

/** Parses `YYYY-MM-DD` or an ISO timestamp to UTC midnight epoch ms of that calendar day. */
export function dayMs(date: string): number {
  const d = date.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new RangeError(`bad date: ${date}`);
  const ms = Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  if (Number.isNaN(ms)) throw new RangeError(`bad date: ${date}`);
  return ms;
}

/** Whole days from `a` to `b` (calendar days, UTC). */
export function daysBetween(a: string, b: string): number {
  return Math.round((dayMs(b) - dayMs(a)) / DAY_MS);
}

export function addDays(date: string, days: number): string {
  return new Date(dayMs(date) + days * DAY_MS).toISOString().slice(0, 10);
}

export function toDay(date: string): string {
  return new Date(dayMs(date)).toISOString().slice(0, 10);
}

/** `YYYY-MM` → `[first day, first day of next month)` as `YYYY-MM-DD`. */
export function periodBounds(period: string): { from: string; toExclusive: string } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new RangeError(`bad period: ${period}`);
  const y = Number(period.slice(0, 4));
  const m = Number(period.slice(5, 7));
  const from = `${period}-01`;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { from, toExclusive: next };
}

export function previousPeriod(period: string): string {
  const { from } = periodBounds(period);
  return addDays(from, -1).slice(0, 7);
}
