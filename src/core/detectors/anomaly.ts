// Bill anomaly detection (PRD §15.2). Pure. The Gate reuses `madAnomaly` for FR4.3; callers
// pass FX-normalized values (see `normalizeAmounts` in ./recurring) so a foreign-currency bill is
// not flagged solely because the exchange rate moved (FR18.3).

import { type ChargeTx, type RateLookup, normalizeAmounts } from "./recurring";
import { mad, median, round2 } from "./stats";

/** 1.4826 · MAD estimates σ for normal data. */
export const MAD_SCALE = 1.4826;

export type MadOptions = {
  k: number;
  minHistory: number;
  /** Optional floor on the scale 1.4826·MAD (same units as x). Default 0: the plain PRD formula. */
  minScale?: number;
};

export type AnomalyResult = {
  anomalous: boolean;
  reason: "insufficient_history" | "z_exceeds_k" | "within_k";
  z: number | null; // null when history is too short
  median: number | null;
  mad: number | null;
};

/**
 * Robust z-score check: `z = |x − median(H)| / (1.4826 · MAD(H))`; anomalous (confirm) if
 * `z > k` or `|H| < minHistory`. With MAD = 0 (constant history) any deviation is anomalous.
 */
export function madAnomaly(x: number, history: readonly number[], opts: MadOptions): AnomalyResult {
  if (!Number.isFinite(x)) throw new RangeError("madAnomaly: x must be finite");
  if (!(opts.k > 0)) throw new RangeError("madAnomaly: k must be positive");
  if (history.length === 0 || history.length < opts.minHistory) {
    return { anomalous: true, reason: "insufficient_history", z: null, median: null, mad: null };
  }
  const m = median(history);
  const d = mad(history);
  const dev = Math.abs(x - m);
  const scale = Math.max(MAD_SCALE * d, opts.minScale ?? 0);
  const z = scale === 0 ? (dev === 0 ? 0 : Infinity) : dev / scale;
  const anomalous = z > opts.k;
  return { anomalous, reason: anomalous ? "z_exceeds_k" : "within_k", z, median: m, mad: d };
}

export type ConformalResult = {
  anomalous: boolean;
  reason: "insufficient_history" | "outside_quantile" | "within_quantile";
  threshold: number | null; // q
  score: number | null; // |x − m|
};

/** Minimum history for the conformal check: ⌈(n+1)(1−α)⌉ ≤ n. */
export function conformalMinHistory(alpha: number): number {
  if (!(alpha > 0 && alpha < 1)) throw new RangeError("alpha must be in (0, 1)");
  let n = 1;
  while (Math.ceil((n + 1) * (1 - alpha) - 1e-9) > n) n++;
  return n;
}

/**
 * Split-conformal check (PRD §15.2): scores `s_i = |x_i − m|`, `q` = the ⌈(n+1)(1−α)⌉-th
 * smallest score; auto-pay only if `|x − m| ≤ q`. Too little history → always confirm.
 */
export function conformalAnomaly(x: number, history: readonly number[], alpha: number): ConformalResult {
  const n = history.length;
  if (n < conformalMinHistory(alpha)) {
    return { anomalous: true, reason: "insufficient_history", threshold: null, score: null };
  }
  const m = median(history);
  const scores = history.map((h) => Math.abs(h - m)).sort((a, b) => a - b);
  const rank = Math.ceil((n + 1) * (1 - alpha) - 1e-9);
  const q = scores[rank - 1];
  const score = Math.abs(x - m);
  const anomalous = score > q;
  return { anomalous, reason: anomalous ? "outside_quantile" : "within_quantile", threshold: q, score };
}

/**
 * Relative scale floor for FX-normalized series: ECB reference rates differ from the card's
 * own rate by a fraction of a percent, so a perfectly flat normalized history would otherwise
 * flag cent-level noise.
 */
export const FX_NOISE_FLOOR = 0.01;

/**
 * MAD check after FX normalization (PRD §15.1 "the same normalization applies before anomaly
 * checks"; FR18.3). Charges are converted to `currency` at their posting-date rates (or taken
 * from `originalAmount`), rounded to cents, and checked with a 1% scale floor. Returns null if
 * a rate is missing, so the caller can fall back to confirming.
 */
export function fxNormalizedAnomaly(
  latest: ChargeTx,
  history: readonly ChargeTx[],
  currency: string,
  rateOn: RateLookup,
  opts: MadOptions,
): (AnomalyResult & { normalized: number[] }) | null {
  const vals = normalizeAmounts([...history, latest], currency, rateOn);
  if (!vals) return null;
  const rounded = vals.map(round2);
  const x = rounded[rounded.length - 1];
  const h = rounded.slice(0, -1);
  const floor = h.length ? FX_NOISE_FLOOR * Math.abs(median(h)) : 0;
  const r = madAnomaly(x, h, { ...opts, minScale: Math.max(opts.minScale ?? 0, floor) });
  return { ...r, normalized: rounded };
}
