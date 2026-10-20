import { describe, expect, it } from "vitest";
import { binomialCdf, clopperPearsonUpper, ruleOfThreeUpper } from "../../evals/stats";

describe("ruleOfThreeUpper", () => {
  it("is 3 / n", () => {
    expect(ruleOfThreeUpper(40)).toBeCloseTo(0.075, 12);
    expect(ruleOfThreeUpper(20)).toBeCloseTo(0.15, 12);
  });

  it("is capped at 1 and rejects bad n", () => {
    expect(ruleOfThreeUpper(2)).toBe(1);
    expect(() => ruleOfThreeUpper(0)).toThrow(RangeError);
    expect(() => ruleOfThreeUpper(1.5)).toThrow(RangeError);
  });
});

describe("clopperPearsonUpper", () => {
  it("matches the closed form for zero successes (PRD §20.3: n=20 -> 13.9%, n=40 -> 7.2%)", () => {
    for (const n of [5, 20, 40, 100, 1000]) {
      expect(clopperPearsonUpper(0, n)).toBeCloseTo(1 - 0.05 ** (1 / n), 9);
    }
    expect(clopperPearsonUpper(0, 20)).toBeCloseTo(0.1391, 4);
    expect(clopperPearsonUpper(0, 40)).toBeCloseTo(0.0722, 4);
  });

  it("is a little below the rule of three when k = 0", () => {
    expect(clopperPearsonUpper(0, 40)).toBeLessThan(ruleOfThreeUpper(40));
    expect(clopperPearsonUpper(0, 40)).toBeGreaterThan(0.95 * ruleOfThreeUpper(40));
  });

  it("matches published one-sided 95% upper limits for k > 0", () => {
    expect(clopperPearsonUpper(1, 10)).toBeCloseTo(0.3942, 4);
    expect(clopperPearsonUpper(1, 20)).toBeCloseTo(0.2161, 4);
    expect(clopperPearsonUpper(2, 10)).toBeCloseTo(0.5069, 4);
  });

  it("solves P(X <= k | n, p) = alpha", () => {
    for (const [k, n, c] of [[3, 50, 0.95], [7, 200, 0.9], [0, 33, 0.99]] as const) {
      const p = clopperPearsonUpper(k, n, c);
      expect(binomialCdf(k, n, p)).toBeCloseTo(1 - c, 9);
    }
  });

  it("grows with k and shrinks with n", () => {
    expect(clopperPearsonUpper(1, 40)).toBeGreaterThan(clopperPearsonUpper(0, 40));
    expect(clopperPearsonUpper(2, 40)).toBeGreaterThan(clopperPearsonUpper(1, 40));
    expect(clopperPearsonUpper(0, 80)).toBeLessThan(clopperPearsonUpper(0, 40));
  });

  it("is 1 when every trial succeeded and rejects bad input", () => {
    expect(clopperPearsonUpper(10, 10)).toBe(1);
    expect(() => clopperPearsonUpper(-1, 10)).toThrow(RangeError);
    expect(() => clopperPearsonUpper(11, 10)).toThrow(RangeError);
    expect(() => clopperPearsonUpper(0, 0)).toThrow(RangeError);
    expect(() => clopperPearsonUpper(0, 10, 1)).toThrow(RangeError);
  });
});
