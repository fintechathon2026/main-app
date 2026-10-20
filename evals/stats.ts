// Upper confidence bounds for attack-success rates (PRD §20.3, architecture §18.2).
// Pure, dependency-free helpers for the eval report: "k attacks succeeded in n trials" becomes an
// upper bound on the true success rate.

function assertCounts(k: number, n: number): void {
  if (!Number.isInteger(n) || n <= 0) throw new RangeError(`n must be a positive integer, got ${n}`);
  if (!Number.isInteger(k) || k < 0 || k > n) throw new RangeError(`k must be an integer in [0, n], got ${k}`);
}

/**
 * Rule of three: for 0 successes in n trials, the 95% upper bound is about 3 / n. It is an
 * approximation of `1 - 0.05^(1/n)` (slightly high). Only meaningful when k = 0.
 */
export function ruleOfThreeUpper(n: number): number {
  assertCounts(0, n);
  return Math.min(1, 3 / n);
}

/** P(X <= k) for X ~ Binomial(n, p), summed in log space so large n does not underflow. */
export function binomialCdf(k: number, n: number, p: number): number {
  if (p <= 0) return 1;
  if (p >= 1) return k >= n ? 1 : 0;
  const lp = Math.log(p);
  const lq = Math.log1p(-p);
  let logCoef = 0; // log C(n, 0)
  let sum = 0;
  for (let i = 0; i <= k; i++) {
    if (i > 0) logCoef += Math.log((n - i + 1) / i);
    sum += Math.exp(logCoef + i * lp + (n - i) * lq);
  }
  return Math.min(1, sum);
}

/**
 * One-sided Clopper-Pearson (exact) upper bound for k successes in n trials: the p for which
 * P(X <= k | n, p) equals `1 - confidence`. Solved by bisection (the CDF is strictly decreasing
 * in p). For k = 0 it equals `1 - (1 - confidence)^(1/n)`; for k = n it is 1.
 */
export function clopperPearsonUpper(k: number, n: number, confidence = 0.95): number {
  assertCounts(k, n);
  if (!(confidence > 0 && confidence < 1)) throw new RangeError(`confidence must be in (0, 1), got ${confidence}`);
  if (k === n) return 1;
  const alpha = 1 - confidence;
  let lo = k / n; // the CDF at the point estimate is above alpha, so the root is to its right
  let hi = 1;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (binomialCdf(k, n, mid) > alpha) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-15) break;
  }
  return (lo + hi) / 2;
}
