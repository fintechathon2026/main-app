import { describe, expect, it } from "vitest";
import { advisePrepaid } from "./advisor";

const lin = { packagePrice: 6000, sessions: 60, payPerVisitPrice: 125, escrowAvailable: true };

describe("advisePrepaid", () => {
  it("matches Lin's example from PRD §15.11", () => {
    const r = advisePrepaid(lin);
    expect(r.savings).toBe(1500);
    expect(r.breakEvenSessions).toBe(48);
    expect(r.expectedLossWithoutEscrow).toBe(300);
    expect(r.expectedLossWithEscrow).toBe(0);
    expect(r.closureRateSource).toBe("default");
    expect(r.recommendation).toBe("prepay_escrow");
  });

  it("recommends pay-per-visit below break-even", () => {
    expect(advisePrepaid({ ...lin, expectedSessions: 47 }).recommendation).toBe("pay_per_visit");
    expect(advisePrepaid({ ...lin, expectedSessions: 48 }).recommendation).toBe("prepay_escrow");
  });

  it("weighs expected loss when no escrow is available", () => {
    expect(advisePrepaid({ ...lin, escrowAvailable: false }).recommendation).toBe("prepay_with_risk");
    // λ = 0.6: L = 0.6 · 0.5 · 6000 = 1800 > S = 1500
    expect(
      advisePrepaid({ ...lin, escrowAvailable: false, annualClosureRate: 0.6 }).recommendation,
    ).toBe("pay_per_visit");
  });

  it("triples λ on an elevated soft signal and says so", () => {
    const r = advisePrepaid({ ...lin, riskLevel: "elevated" });
    expect(r.closureRateUsed).toBeCloseTo(0.3);
    expect(r.closureRateSource).toBe("elevated_signal");
    expect(r.expectedLossWithoutEscrow).toBe(900);
  });

  it("scales closure probability with the period", () => {
    const r = advisePrepaid({ ...lin, periodMonths: 24 });
    expect(r.periodClosureProbability).toBeCloseTo(0.19);
    expect(r.expectedLossWithoutEscrow).toBe(570);
  });

  it("rejects non-positive inputs", () => {
    expect(() => advisePrepaid({ ...lin, payPerVisitPrice: 0 })).toThrow(RangeError);
    expect(() => advisePrepaid({ ...lin, sessions: 0 })).toThrow(RangeError);
  });
});
