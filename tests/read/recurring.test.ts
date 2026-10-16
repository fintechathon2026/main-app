import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { fxNormalizedAnomaly, madAnomaly } from "@/src/core/detectors/anomaly";
import {
  type ChargeTx,
  type RateLookup,
  detectRecurring,
  groupByMerchant,
  normalizeAmounts,
  recurringStatus,
} from "@/src/core/detectors/recurring";
import { addDays, round2 } from "@/src/core/detectors/stats";

const monthly = (start: string, amounts: number[], every = 30): ChargeTx[] =>
  amounts.map((amount, i) => ({ id: `t${i}`, date: addDays(start, i * every), amount }));

const base = { baseCurrency: "CNY" };

describe("detectRecurring: base rule", () => {
  it("detects a stable monthly charge", () => {
    const r = detectRecurring(monthly("2026-05-05", [25, 25, 25, 25]), base);
    expect(r).toMatchObject({ cycleDays: 30, amount: 25, currency: "CNY", missedCycles: 0, priceChange: null });
    expect(r?.nextExpected).toBe("2026-09-02");
    expect(r?.txIds).toEqual(["t0", "t1", "t2", "t3"]);
  });

  it("needs at least three charges", () => {
    expect(detectRecurring(monthly("2026-05-05", [25, 25]), base)).toBeNull();
  });

  it("accepts calendar-month gaps (28 to 31 days)", () => {
    const dates = ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"];
    const r = detectRecurring(dates.map((date, i) => ({ id: `m${i}`, date, amount: 88 })), base);
    expect(r?.cycleDays).toBe(30);
  });

  it("detects weekly and yearly cadences", () => {
    expect(detectRecurring(monthly("2026-01-01", [10, 10, 10], 7), base)?.cycleDays).toBe(7);
    expect(detectRecurring(monthly("2023-03-01", [298, 298, 298], 365), base)?.cycleDays).toBe(365);
  });

  it("rejects irregular gaps", () => {
    expect(detectRecurring(monthly("2026-01-01", [10, 10, 10], 45), base)).toBeNull();
  });

  it("rejects amount spread above 10% without a stable regime", () => {
    expect(detectRecurring(monthly("2026-01-01", [100, 130, 100, 130]), base)).toBeNull();
  });

  it("accepts spread exactly at 10%", () => {
    expect(detectRecurring(monthly("2026-01-01", [100, 110, 105]), base)).not.toBeNull();
  });

  it("is order-independent", () => {
    const txs = monthly("2026-05-05", [25, 25, 25, 25]);
    expect(detectRecurring([...txs].reverse(), base)).toEqual(detectRecurring(txs, base));
  });
});

describe("detectRecurring: extensions", () => {
  it("allows one missed cycle", () => {
    const txs: ChargeTx[] = ["2026-03-05", "2026-04-05", "2026-06-05", "2026-07-05"].map((date, i) => ({
      id: `t${i}`,
      date,
      amount: 15,
    }));
    const r = detectRecurring(txs, base);
    expect(r).toMatchObject({ cycleDays: 30, missedCycles: 1 });
    expect(r?.confidence).toBeLessThan(detectRecurring(monthly("2026-03-05", [15, 15, 15, 15]), base)!.confidence);
  });

  it("rejects two missed cycles", () => {
    const txs: ChargeTx[] = ["2026-01-05", "2026-03-05", "2026-04-05", "2026-06-05"].map((date, i) => ({
      id: `t${i}`,
      date,
      amount: 15,
    }));
    expect(detectRecurring(txs, base)).toBeNull();
  });

  it("detects a price change as a new regime", () => {
    const r = detectRecurring(monthly("2026-05-05", [25, 25, 25, 30]), base);
    expect(r).toMatchObject({ cycleDays: 30, amount: 30 });
    expect(r?.priceChange).toEqual({ from: 25, to: 30, at: "2026-08-03" });
    expect(r?.regimes).toHaveLength(2);
  });

  it("does not treat a single odd charge in the middle as a regime", () => {
    expect(detectRecurring(monthly("2026-05-05", [25, 80, 25, 25]), base)).toBeNull();
  });
});

describe("detectRecurring: FX normalization (FR18.3 AC)", () => {
  // USD 20/month; CNY rate wobbles ±5% around 7.1, so the CNY charge moves with it.
  const usdRates: Record<string, number> = {};
  const factors = [1, 1.05, 0.95, 1.04, 0.96, 1.05, 0.95];
  const start = "2026-03-24";
  const txs: ChargeTx[] = factors.map((f, i) => {
    const date = addDays(start, i * 30);
    usdRates[date] = 7.1 * f;
    return { id: `gpt${i}`, date, amount: Math.round(20 * 7.1 * f * 100) / 100 };
  });
  const rateOn: RateLookup = (cur, date) =>
    cur === "USD" && usdRates[date] ? { rate: usdRates[date], date } : null;

  it("without the hint, a wider (±6%) CNY wobble fails the 10% spread test", () => {
    const wide = txs.map((t, i) => ({ ...t, amount: 142 * (i % 2 ? 1.06 : 0.94) }));
    expect(detectRecurring(wide, base)).toBeNull();
  });

  it("is still recurring when normalized back to USD", () => {
    const r = detectRecurring(txs, { ...base, candidateCurrencies: ["USD"], rateOn });
    expect(r).toMatchObject({ cycleDays: 30, currency: "USD", normalizedBy: "fx_rate", amount: 20, priceChange: null });
  });

  it("uses original_amount when the source provides it", () => {
    const withOrig = txs.map((t) => ({ ...t, originalAmount: 20, originalCurrency: "USD" }));
    const r = detectRecurring(withOrig, base);
    expect(r).toMatchObject({ currency: "USD", normalizedBy: "original_amount", amount: 20 });
  });

  it("is not anomalous solely due to FX after normalization", () => {
    const latest = txs[txs.length - 1];
    const r = fxNormalizedAnomaly(latest, txs.slice(0, -1), "USD", rateOn, { k: 3.5, minHistory: 3 });
    expect(r?.anomalous).toBe(false);
    expect(r?.normalized.every((v) => v === 20)).toBe(true);
  });

  it("a 5% FX jump after a flat history flags raw CNY but not the normalized USD amount", () => {
    const rates: Record<string, number> = {
      "2026-06-01": 7.1,
      "2026-07-01": 7.1,
      "2026-07-31": 7.1,
      "2026-08-30": 7.455,
    };
    const look: RateLookup = (c, d) => (c === "USD" && rates[d] ? { rate: rates[d], date: d } : null);
    const series: ChargeTx[] = Object.entries(rates).map(([date, r], i) => ({ id: `j${i}`, date, amount: round2(20 * r) }));
    const latest = series[3];
    const opts = { k: 3.5, minHistory: 3 };
    expect(madAnomaly(latest.amount, series.slice(0, 3).map((t) => t.amount), opts).anomalous).toBe(true);
    expect(fxNormalizedAnomaly(latest, series.slice(0, 3), "USD", look, opts)?.anomalous).toBe(false);
  });

  it("tolerates card-rate noise but still flags a real price jump in USD", () => {
    const noisy = txs.map((t, i) => ({ ...t, amount: t.amount * (1 + (i % 2 ? 0.003 : -0.003)) }));
    const latest = noisy[noisy.length - 1];
    const opts = { k: 3.5, minHistory: 3 };
    expect(fxNormalizedAnomaly(latest, noisy.slice(0, -1), "USD", rateOn, opts)?.anomalous).toBe(false);
    const jump = { ...latest, amount: latest.amount * 1.5 };
    expect(fxNormalizedAnomaly(jump, noisy.slice(0, -1), "USD", rateOn, opts)?.anomalous).toBe(true);
    expect(fxNormalizedAnomaly(latest, noisy.slice(0, -1), "EUR", rateOn, opts)).toBeNull();
  });

  it("normalizeAmounts returns null on a missing rate", () => {
    expect(normalizeAmounts(txs, "EUR", rateOn)).toBeNull();
  });

  it("property: any ±5% rate path keeps a USD plan recurring", () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: -0.05, max: 0.05, noNaN: true }), { minLength: 3, maxLength: 12 }), (ds) => {
        const rates: Record<string, number> = {};
        const series: ChargeTx[] = ds.map((d, i) => {
          const date = addDays("2025-01-10", i * 30);
          rates[date] = 7.1 * (1 + d);
          return { id: `x${i}`, date, amount: 20 * rates[date] };
        });
        const r = detectRecurring(series, {
          ...base,
          candidateCurrencies: ["USD"],
          rateOn: (c, date) => (c === "USD" ? { rate: rates[date], date } : null),
        });
        expect(r?.cycleDays).toBe(30);
        expect(r?.amount).toBeCloseTo(20, 1);
      }),
    );
  });
});

describe("detectRecurring: properties", () => {
  it("any constant amount on a jittered monthly cadence is recurring", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50_000 }),
        fc.array(fc.integer({ min: -3, max: 3 }), { minLength: 2, maxLength: 11 }),
        (amount, jitter) => {
          let date = "2025-01-15";
          const txs: ChargeTx[] = [{ id: "a0", date, amount }];
          jitter.forEach((j, i) => {
            date = addDays(date, 30 + j);
            txs.push({ id: `a${i + 1}`, date, amount });
          });
          const r = detectRecurring(txs, base);
          expect(r?.cycleDays).toBe(30);
          expect(r?.amount).toBe(amount);
        },
      ),
    );
  });
});

describe("recurringStatus (FR5.4)", () => {
  it("goes inactive after one cycle plus tolerance", () => {
    expect(recurringStatus("2026-09-10", 30, "2026-10-13")).toBe("active");
    expect(recurringStatus("2026-09-10", 30, "2026-10-14")).toBe("inactive");
  });
});

describe("groupByMerchant", () => {
  it("groups and skips unmatched rows", () => {
    const g = groupByMerchant([
      { id: "1", date: "2026-01-01", amount: 1, merchantId: "b" },
      { id: "2", date: "2026-01-01", amount: 1, merchantId: "a" },
      { id: "3", date: "2026-01-01", amount: 1, merchantId: null },
      { id: "4", date: "2026-02-01", amount: 1, merchantId: "a" },
    ]);
    expect(g.map((x) => [x.merchantId, x.txs.length])).toEqual([
      ["a", 2],
      ["b", 1],
    ]);
  });
});
