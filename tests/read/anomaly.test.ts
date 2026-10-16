import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { conformalAnomaly, conformalMinHistory, madAnomaly } from "@/src/core/detectors/anomaly";
import { mad, median } from "@/src/core/detectors/stats";

describe("median / mad", () => {
  it("computes odd and even medians", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(mad([1, 1, 2, 2, 4, 6, 9])).toBe(1);
  });
  it("throws on empty input", () => {
    expect(() => median([])).toThrow(RangeError);
  });
});

describe("madAnomaly (PRD §15.2)", () => {
  const electricity = [180, 175, 192, 186, 178, 190];

  it("passes a normal bill", () => {
    const r = madAnomaly(188, electricity, { k: 3.5, minHistory: 3 });
    expect(r.anomalous).toBe(false);
    expect(r.reason).toBe("within_k");
    expect(r.median).toBe(183);
  });

  it("flags a bill far above history", () => {
    const r = madAnomaly(520, electricity, { k: 3.5, minHistory: 3 });
    expect(r.anomalous).toBe(true);
    expect(r.reason).toBe("z_exceeds_k");
    expect(r.z).toBeGreaterThan(3.5);
  });

  it("always confirms with short history", () => {
    const r = madAnomaly(180, [180, 181], { k: 3.5, minHistory: 3 });
    expect(r).toMatchObject({ anomalous: true, reason: "insufficient_history", z: null });
    expect(madAnomaly(1, [], { k: 3, minHistory: 0 }).anomalous).toBe(true);
  });

  it("treats MAD = 0 strictly", () => {
    expect(madAnomaly(88, [88, 88, 88], { k: 3, minHistory: 3 }).anomalous).toBe(false);
    expect(madAnomaly(89, [88, 88, 88], { k: 3, minHistory: 3 }).anomalous).toBe(true);
  });

  it("uses the 1.4826 scale", () => {
    // H = [10, 12, 14]: median 12, MAD 2 → σ̂ = 2.9652; x = 18 → z ≈ 2.0235
    const r = madAnomaly(18, [10, 12, 14], { k: 2, minHistory: 3 });
    expect(r.z).toBeCloseTo(6 / 2.9652, 4);
    expect(r.anomalous).toBe(true);
  });

  it("rejects bad parameters", () => {
    expect(() => madAnomaly(NaN, [1, 2, 3], { k: 3, minHistory: 1 })).toThrow(RangeError);
    expect(() => madAnomaly(1, [1, 2, 3], { k: 0, minHistory: 1 })).toThrow(RangeError);
  });

  it("property: the history median is never anomalous", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 100_000 }), { minLength: 3, maxLength: 30 }), (h) => {
        expect(madAnomaly(median(h), h, { k: 1, minHistory: 3 }).anomalous).toBe(false);
      }),
    );
  });

  it("property: invariant to shifting history and x by the same amount", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 10_000 }), { minLength: 3, maxLength: 20 }),
        fc.integer({ min: 1, max: 20_000 }),
        fc.integer({ min: -500, max: 500 }),
        (h, x, s) => {
          const a = madAnomaly(x, h, { k: 3, minHistory: 3 });
          const b = madAnomaly(x + s, h.map((v) => v + s), { k: 3, minHistory: 3 });
          expect(b.anomalous).toBe(a.anomalous);
        },
      ),
    );
  });
});

describe("conformalAnomaly", () => {
  it("needs n ≥ 9 for α = 0.1 and n ≥ 4 for α = 0.2", () => {
    expect(conformalMinHistory(0.1)).toBe(9);
    expect(conformalMinHistory(0.2)).toBe(4);
    expect(conformalAnomaly(100, [100, 100, 100], 0.2).reason).toBe("insufficient_history");
  });

  it("accepts within the quantile and flags outside", () => {
    const h = [100, 102, 98, 101, 99, 103, 97, 100, 104];
    expect(conformalAnomaly(101, h, 0.1).anomalous).toBe(false);
    expect(conformalAnomaly(130, h, 0.1).anomalous).toBe(true);
    expect(conformalAnomaly(130, h, 0.1).threshold).toBe(4);
  });
});
