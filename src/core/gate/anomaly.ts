// Owner: R2 (roles.md). Minimal version by R1; extend, don't duplicate.
// Bill anomaly detection (PRD §15.2). Pure.

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Median absolute deviation (unscaled). */
export function mad(xs: readonly number[]): number {
  const m = median(xs);
  return median(xs.map((x) => Math.abs(x - m)));
}

export type AnomalyVerdict = {
  anomalous: boolean;
  reason: "insufficient_history" | "over_threshold" | "within_threshold";
  z?: number;
  median?: number;
  q?: number;
};

/** Robust z = |x − median(H)| / (1.4826 · MAD(H)); confirm if z > k or |H| < minHistory. */
export function medianMadCheck(x: number, history: readonly number[], k: number, minHistory: number): AnomalyVerdict {
  if (history.length < minHistory || history.length === 0) {
    return { anomalous: true, reason: "insufficient_history" };
  }
  const m = median(history);
  const scale = 1.4826 * mad(history);
  const dev = Math.abs(x - m);
  // MAD of 0 (all history equal): any deviation is infinitely anomalous, none is not.
  const z = scale === 0 ? (dev === 0 ? 0 : Number.POSITIVE_INFINITY) : dev / scale;
  return { anomalous: z > k, reason: z > k ? "over_threshold" : "within_threshold", z, median: m };
}

/** Split-conformal check: auto-pay iff |x − m| ≤ q, q = ⌈(n+1)(1−α)⌉-th smallest score. */
export function conformalCheck(x: number, history: readonly number[], alpha: number): AnomalyVerdict {
  const n = history.length;
  // Fail closed on an invalid alpha: it must never turn into a "pass".
  if (!Number.isFinite(alpha) || alpha <= 0 || alpha >= 1) return { anomalous: true, reason: "insufficient_history" };
  // Same epsilon as src/core/detectors/anomaly.ts: (n+1)(1-alpha) can land just above an integer.
  const rank = Math.ceil((n + 1) * (1 - alpha) - 1e-9);
  if (n === 0 || rank > n) return { anomalous: true, reason: "insufficient_history" };
  const m = median(history);
  const scores = history.map((h) => Math.abs(h - m)).sort((a, b) => a - b);
  const q = scores[rank - 1];
  const anomalous = Math.abs(x - m) > q;
  return { anomalous, reason: anomalous ? "over_threshold" : "within_threshold", median: m, q };
}
