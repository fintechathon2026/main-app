// Owner: R3 (roles.md).
import { describe, expect, it } from "vitest";
import { parseSweepAmount } from "./money";

describe("parseSweepAmount", () => {
  it("accepts positive amounts with at most two decimals", () => {
    expect(parseSweepAmount(12.5)).toBe("12.5");
    expect(parseSweepAmount(12.50)).toBe("12.5");
    expect(parseSweepAmount(0.01)).toBe("0.01");
    expect(parseSweepAmount(3000)).toBe("3000");
    expect(parseSweepAmount(999999999999.99)).toBe("999999999999.99");
  });

  it("rejects more than two decimals, zero, negatives and non-finite numbers", () => {
    for (const v of [12.505, 0.1 + 0.2, 0, -0, -5, NaN, Infinity, -Infinity, 1e-7]) {
      expect(parseSweepAmount(v)).toBeNull();
    }
  });

  it("rejects values beyond numeric(14,2)", () => {
    expect(parseSweepAmount(1e12)).toBeNull();
    expect(parseSweepAmount(1e21)).toBeNull();
  });

  it("rejects non-numbers", () => {
    for (const v of ["abc", "100", "12.50", null, undefined, {}]) {
      expect(parseSweepAmount(v)).toBeNull();
    }
  });
});
