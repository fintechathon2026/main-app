// Prepaid purchase advisor (PRD §15.11). Pure: no I/O, no clock.
// Amounts are in base-currency units (yuan for Lin); results are rounded to 2 decimals.

export type RiskLevel = "none" | "watch" | "elevated";

export type AdvisorInput = {
  packagePrice: number; // P
  sessions: number; // N
  payPerVisitPrice: number; // q
  expectedSessions?: number; // n_e, default N
  periodMonths?: number; // t, default 12
  annualClosureRate?: number; // λ, default DEFAULT_ANNUAL_CLOSURE_RATE
  unusedFractionAtClosure?: number; // u, default 0.5
  escrowAvailable: boolean;
  riskLevel?: RiskLevel; // from soft signals; "elevated" raises λ
};

export type Recommendation = "pay_per_visit" | "prepay_escrow" | "prepay_with_risk";

export type AdvisorResult = {
  savings: number; // S = N·q − P
  breakEvenSessions: number; // k* = ⌈P / q⌉
  closureRateUsed: number; // λ after any risk adjustment
  closureRateSource: "default" | "input" | "elevated_signal";
  periodClosureProbability: number; // λ_t = 1 − (1 − λ)^(t/12)
  expectedLossWithoutEscrow: number; // L = λ_t · u · P
  expectedLossWithEscrow: number; // ≈ 0 with an attested exit
  recommendation: Recommendation;
};

// 2022 gym closure figure (PRD §2.2.1) [verify primary source].
export const DEFAULT_ANNUAL_CLOSURE_RATE = 0.1;
export const ELEVATED_RISK_MULTIPLIER = 3;

const round2 = (x: number) => Math.round(x * 100) / 100;

export function advisePrepaid(input: AdvisorInput): AdvisorResult {
  const { packagePrice: P, sessions: N, payPerVisitPrice: q, escrowAvailable } = input;
  if (!(P > 0) || !(q > 0) || !Number.isInteger(N) || N <= 0) {
    throw new RangeError("advisePrepaid: price, sessions and pay-per-visit price must be positive");
  }
  const expected = input.expectedSessions ?? N;
  const months = input.periodMonths ?? 12;
  const u = input.unusedFractionAtClosure ?? 0.5;

  let lambda = input.annualClosureRate ?? DEFAULT_ANNUAL_CLOSURE_RATE;
  let source: AdvisorResult["closureRateSource"] =
    input.annualClosureRate === undefined ? "default" : "input";
  if (input.riskLevel === "elevated") {
    lambda = Math.min(1, lambda * ELEVATED_RISK_MULTIPLIER);
    source = "elevated_signal";
  }

  const savings = N * q - P;
  const breakEvenSessions = Math.ceil(P / q);
  const lambdaT = 1 - Math.pow(1 - lambda, months / 12);
  const lossWithout = lambdaT * u * P;

  let recommendation: Recommendation;
  if (expected < breakEvenSessions) recommendation = "pay_per_visit";
  else if (escrowAvailable && savings > 0) recommendation = "prepay_escrow";
  else if (!escrowAvailable && savings - lossWithout > 0) recommendation = "prepay_with_risk";
  else recommendation = "pay_per_visit";

  return {
    savings: round2(savings),
    breakEvenSessions,
    closureRateUsed: lambda,
    closureRateSource: source,
    periodClosureProbability: round2(lambdaT * 10000) / 10000,
    expectedLossWithoutEscrow: round2(lossWithout),
    expectedLossWithEscrow: 0,
    recommendation,
  };
}
