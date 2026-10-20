import { describe, expect, it } from "vitest";
import { conformalCheck, mad, median, medianMadCheck } from "./anomaly";

describe("median / mad helpers", () => {
  it("takes the middle of an odd list and the mean of the middle pair of an even list", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
  it("is NaN on an empty list (callers must guard)", () => {
    expect(median([])).toBeNaN();
    expect(mad([])).toBeNaN();
  });
  it("mad is the unscaled median absolute deviation", () => {
    expect(mad([-2, -1, 0, 1, 2])).toBe(1);
    expect(mad([5, 5, 5])).toBe(0);
  });
  it("does not mutate its input", () => {
    const h = [3, 1, 2];
    median(h);
    mad(h);
    expect(h).toEqual([3, 1, 2]);
  });
});

describe("medianMadCheck", () => {
  // median 0, |dev| = [2,1,0,1,2] so MAD = 1 and the scale is exactly 1.4826.
  const H = [-2, -1, 0, 1, 2];
  const SCALE = 1.4826;

  describe("history length", () => {
    it("is insufficient for an empty history, even when minHistory is 0", () => {
      expect(medianMadCheck(10, [], 3, 0)).toEqual({ anomalous: true, reason: "insufficient_history" });
    });
    it("is insufficient one below minHistory", () => {
      const r = medianMadCheck(0, [0, 0], 3, 3);
      expect(r.anomalous).toBe(true);
      expect(r.reason).toBe("insufficient_history");
      expect(r.z).toBeUndefined();
    });
    it("evaluates once the history reaches minHistory", () => {
      const r = medianMadCheck(98, [98, 98, 98], 3, 3);
      expect(r).toMatchObject({ anomalous: false, reason: "within_threshold", z: 0, median: 98 });
    });
    it("with minHistory 1 a single point is a valid history (MAD 0)", () => {
      expect(medianMadCheck(5, [5], 3, 1).anomalous).toBe(false);
      expect(medianMadCheck(6, [5], 3, 1).anomalous).toBe(true);
    });
    it("the mandate's disabled sentinel (huge minHistory) always confirms", () => {
      const r = medianMadCheck(98, [98, 98, 98, 98, 98], 0, Number.MAX_SAFE_INTEGER);
      expect(r).toEqual({ anomalous: true, reason: "insufficient_history" });
    });
  });

  describe("threshold", () => {
    it("z exactly equal to k is not anomalous (strict >)", () => {
      const r = medianMadCheck(SCALE, H, 1, 3);
      expect(r.z).toBe(1);
      expect(r.anomalous).toBe(false);
      expect(r.reason).toBe("within_threshold");
    });
    it("z just above k is anomalous", () => {
      const r = medianMadCheck(SCALE + 0.001, H, 1, 3);
      expect(r.z).toBeGreaterThan(1);
      expect(r).toMatchObject({ anomalous: true, reason: "over_threshold", median: 0 });
    });
    it("is symmetric below the median", () => {
      expect(medianMadCheck(-SCALE, H, 1, 3).anomalous).toBe(false);
      expect(medianMadCheck(-SCALE - 0.001, H, 1, 3).anomalous).toBe(true);
    });
    it("scales with k", () => {
      expect(medianMadCheck(2 * SCALE, H, 2, 3).anomalous).toBe(false);
      expect(medianMadCheck(2 * SCALE, H, 1.5, 3).anomalous).toBe(true);
    });
    it("k = 0 flags any deviation but not a value equal to the median", () => {
      expect(medianMadCheck(0, H, 0, 3).anomalous).toBe(false);
      expect(medianMadCheck(0.001, H, 0, 3).anomalous).toBe(true);
    });
    it("uses the median of an even-length history", () => {
      // median 2.5, |dev| = [1.5, 0.5, 0.5, 1.5] so MAD 1
      const r = medianMadCheck(2.5, [1, 2, 3, 4], 3, 3);
      expect(r.median).toBe(2.5);
      expect(r.z).toBe(0);
    });
    it("the PRD electricity example: 612 is anomalous, 231 is not", () => {
      const h = [196, 214, 238, 205, 251, 222];
      expect(medianMadCheck(612, h, 3, 3).anomalous).toBe(true);
      expect(medianMadCheck(231, h, 3, 3).anomalous).toBe(false);
    });
  });

  describe("zero MAD (constant history)", () => {
    it("equal value gives z 0 and passes", () => {
      expect(medianMadCheck(98, [98, 98, 98], 3, 3)).toMatchObject({ anomalous: false, z: 0 });
    });
    it("any deviation, however small, is infinitely anomalous", () => {
      const r = medianMadCheck(98.01, [98, 98, 98], 3, 3);
      expect(r).toMatchObject({ anomalous: true, reason: "over_threshold", z: Number.POSITIVE_INFINITY });
    });
    it("a majority of equal values also gives MAD 0", () => {
      // median 100, |dev| = [0,0,0,5,900]: MAD 0, so 101 is infinitely anomalous
      expect(medianMadCheck(101, [100, 100, 100, 105, 1000], 3, 3).anomalous).toBe(true);
    });
  });

  it("does not mutate the history", () => {
    const h = [3, 1, 2, 5, 4];
    medianMadCheck(3, h, 3, 3);
    expect(h).toEqual([3, 1, 2, 5, 4]);
  });
});

describe("conformalCheck", () => {
  // 1..9: median 5, sorted scores [0,1,1,2,2,3,3,4,4].
  const H9 = [1, 2, 3, 4, 5, 6, 7, 8, 9];

  describe("minimum history: need ceil((n+1)(1-alpha)) <= n", () => {
    it("empty history is insufficient", () => {
      expect(conformalCheck(1, [], 0.1)).toEqual({ anomalous: true, reason: "insufficient_history" });
    });
    it("alpha 0.1 needs 9 points: 8 is insufficient, 9 is evaluated", () => {
      expect(conformalCheck(5, H9.slice(0, 8), 0.1).reason).toBe("insufficient_history");
      expect(conformalCheck(5, H9, 0.1).reason).toBe("within_threshold");
    });
    it("alpha 0.2 needs 4 points: 3 is insufficient, 4 is evaluated", () => {
      expect(conformalCheck(2, [1, 2, 3], 0.2).reason).toBe("insufficient_history");
      expect(conformalCheck(2, [1, 2, 3, 2], 0.2).reason).not.toBe("insufficient_history");
    });
    it("alpha 0.5 needs only 1 point", () => {
      expect(conformalCheck(5, [5], 0.5)).toMatchObject({ anomalous: false, q: 0 });
    });
    it("alpha 0 never has enough history (rank n+1 > n)", () => {
      expect(conformalCheck(5, H9, 0).reason).toBe("insufficient_history");
    });
    it("insufficient history carries no median or quantile", () => {
      const r = conformalCheck(5, [1, 2], 0.1);
      expect(r.median).toBeUndefined();
      expect(r.q).toBeUndefined();
    });
  });

  describe("quantile boundary", () => {
    it("|x - m| exactly equal to q is not anomalous", () => {
      // alpha 0.1, n = 9: rank 9, q = largest score = 4
      expect(conformalCheck(9, H9, 0.1)).toEqual({ anomalous: false, reason: "within_threshold", median: 5, q: 4 });
      expect(conformalCheck(1, H9, 0.1).anomalous).toBe(false);
    });
    it("just above q is anomalous, on either side", () => {
      expect(conformalCheck(9.01, H9, 0.1)).toEqual({ anomalous: true, reason: "over_threshold", median: 5, q: 4 });
      expect(conformalCheck(0.99, H9, 0.1).anomalous).toBe(true);
    });
    it("a larger alpha picks a lower-ranked (smaller) quantile", () => {
      // alpha 0.3, n = 9: rank ceil(10 * 0.7) = 7, q = 3
      const r = conformalCheck(8, H9, 0.3);
      expect(r.q).toBe(3);
      expect(r.anomalous).toBe(false);
      expect(conformalCheck(8.01, H9, 0.3).anomalous).toBe(true);
    });
    it("alpha 0.5 with 3 points uses the second smallest score", () => {
      // [1,2,3]: median 2, scores [0,1,1], rank ceil(4 * 0.5) = 2, q = 1
      expect(conformalCheck(3, [1, 2, 3], 0.5).q).toBe(1);
      expect(conformalCheck(3, [1, 2, 3], 0.5).anomalous).toBe(false);
      expect(conformalCheck(3.01, [1, 2, 3], 0.5).anomalous).toBe(true);
    });
    it("a constant history has q = 0: only the same value passes", () => {
      const h = [98, 98, 98, 98, 98, 98, 98, 98, 98];
      expect(conformalCheck(98, h, 0.1)).toMatchObject({ anomalous: false, q: 0 });
      expect(conformalCheck(98.01, h, 0.1).anomalous).toBe(true);
    });
    it("is order independent and does not mutate the history", () => {
      const shuffled = [9, 1, 5, 3, 7, 2, 8, 4, 6];
      const copy = [...shuffled];
      expect(conformalCheck(9, shuffled, 0.1)).toEqual(conformalCheck(9, H9, 0.1));
      expect(shuffled).toEqual(copy);
    });
    it("handles an even-length history (median is the mean of the middle pair)", () => {
      // 1..10: median 5.5, scores [.5,.5,1.5,1.5,2.5,2.5,3.5,3.5,4.5,4.5], rank ceil(11 * 0.9) = 10, q 4.5
      const h = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const r = conformalCheck(10, h, 0.1);
      expect(r).toMatchObject({ median: 5.5, q: 4.5, anomalous: false });
      expect(conformalCheck(10.01, h, 0.1).anomalous).toBe(true);
    });
  });

  // Known weaknesses, kept as documented expected failures (see the R2 report). The mandate
  // schema (alpha in the open interval (0, 1)) keeps both unreachable from decide().
  describe("known gaps", () => {
    it.fails("floating-point ceil: alpha 0.42, n = 49 must use rank 29, not 30", () => {
      // 50 * (1 - 0.42) = 29.000000000000004, so a plain Math.ceil gives 30. The detectors
      // version subtracts 1e-9 first. Spec rank 29 gives q = 14, so |x - m| = 15 is anomalous.
      const h = Array.from({ length: 49 }, (_, i) => i + 1); // median 25
      expect(conformalCheck(40, h, 0.42).anomalous).toBe(true);
    });
    it.fails("alpha >= 1 must not silently pass everything", () => {
      // rank = 0, so scores[-1] is undefined and `score > undefined` is false.
      expect(conformalCheck(1_000_000, H9, 1).anomalous).toBe(true);
    });
  });
});
