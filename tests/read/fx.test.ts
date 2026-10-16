import { describe, expect, it } from "vitest";
import { verifyCronAuth } from "@/src/server/auth/cron";
import type { FxRateRow } from "@/src/server/db/read/fx";
import { type FetchLike, type FxRowLookup, fetchFrankfurter, getRate, storeFxRates, syncFxRates } from "@/src/server/fx/frankfurter";

const NOW = "2026-10-17T00:00:00.000Z";

function fakeFetch(bodies: Record<string, unknown>, status = 200): FetchLike & { urls: string[] } {
  const urls: string[] = [];
  const f = (async (url: string) => {
    urls.push(url);
    const base = new URL(url).searchParams.get("base") ?? "";
    return { ok: status === 200, status, json: async () => bodies[base] };
  }) as FetchLike & { urls: string[] };
  f.urls = urls;
  return f;
}

const bodies = {
  USD: { amount: 1, base: "USD", date: "2026-10-16", rates: { CNY: 7.12, IDR: 16250.5 } },
  EUR: { amount: 1, base: "EUR", date: "2026-10-16", rates: { CNY: 8.31, IDR: 18960.2 } },
};

describe("Frankfurter client", () => {
  it("fetches latest rates with symbols", async () => {
    const f = fakeFetch(bodies);
    const r = await fetchFrankfurter("USD", ["CNY", "IDR"], { fetchImpl: f });
    expect(r.rates.CNY).toBe(7.12);
    expect(f.urls[0]).toBe("https://api.frankfurter.dev/v1/latest?base=USD&symbols=CNY,IDR");
  });

  it("throws on HTTP errors and malformed bodies", async () => {
    await expect(fetchFrankfurter("USD", ["CNY"], { fetchImpl: fakeFetch(bodies, 503) })).rejects.toThrow(/503/);
    await expect(fetchFrankfurter("USD", ["CNY"], { fetchImpl: fakeFetch({ USD: { base: "USD", rates: {} } }) })).rejects.toThrow();
    await expect(
      fetchFrankfurter("USD", ["CNY"], { fetchImpl: fakeFetch({ USD: { ...bodies.USD, rates: { CNY: -1 } } }) }),
    ).rejects.toThrow();
  });

  it("syncs USD and EUR into CNY and IDR rows labeled fx_provider", async () => {
    const stored: unknown[] = [];
    const rows = await syncFxRates({ now: NOW, fetchImpl: fakeFetch(bodies), store: async (r) => void stored.push(...r) });
    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual({ date: "2026-10-16", base: "USD", quote: "CNY", rate: 7.12, source: "fx_provider", fetched_at: NOW });
    expect(stored).toEqual(rows);
  });

  it("fails when a requested quote is missing", async () => {
    const partial = { ...bodies, EUR: { ...bodies.EUR, rates: { CNY: 8.31 } } };
    await expect(syncFxRates({ now: NOW, fetchImpl: fakeFetch(partial), store: async () => {} })).rejects.toThrow(/EUR\/IDR/);
  });

  it("stores with an upsert on (date, base, quote)", async () => {
    const calls: { text: string; values?: unknown[] }[] = [];
    await storeFxRates(
      { query: async (text, values) => (calls.push({ text, values }), { rows: [] }) },
      [{ date: "2026-10-16", base: "USD", quote: "CNY", rate: 7.12, source: "fx_provider", fetched_at: NOW }],
    );
    expect(calls[0].text).toContain("on conflict (date, base, quote)");
    expect(calls[0].values).toEqual(["2026-10-16", "USD", "CNY", 7.12, NOW]);
  });
});

describe("getRate", () => {
  const rows: FxRateRow[] = [
    { date: "2026-10-16", base: "USD", quote: "CNY", rate: 7.12, source: "fx_provider", fetched_at: null },
    { date: "2026-10-09", base: "EUR", quote: "CNY", rate: 8.2, source: "fx_provider", fetched_at: null },
  ];
  const lookup: FxRowLookup = async (b, q, d) =>
    rows.filter((r) => r.base === b && r.quote === q && r.date <= d).sort((x, y) => y.date.localeCompare(x.date))[0] ?? null;

  it("returns the latest rate on or before the date with staleness", async () => {
    expect(await getRate("USD", "CNY", "2026-10-17", lookup)).toMatchObject({ rate: 7.12, rateDate: "2026-10-16", staleDays: 1, stale: false });
    expect(await getRate("USD", "CNY", "2026-10-18", lookup)).toMatchObject({ staleDays: 2, stale: false });
    expect(await getRate("USD", "CNY", "2026-10-19", lookup)).toMatchObject({ staleDays: 3, stale: true });
    expect(await getRate("EUR", "CNY", "2026-10-17", lookup)).toMatchObject({ stale: true });
  });

  it("inverts a stored quote→base row", async () => {
    const r = await getRate("CNY", "USD", "2026-10-17", lookup);
    expect(r).toMatchObject({ inverted: true, rateDate: "2026-10-16" });
    expect(r?.rate).toBeCloseTo(1 / 7.12, 6);
  });

  it("is 1 for the same currency and null when nothing is stored", async () => {
    expect((await getRate("CNY", "CNY", "2026-10-17", lookup))?.rate).toBe(1);
    expect(await getRate("USD", "IDR", "2026-10-17", lookup)).toBeNull();
    expect(await getRate("USD", "CNY", "2026-10-01", lookup)).toBeNull();
  });
});

describe("verifyCronAuth", () => {
  const secret = "s3cret-s3cret-s3cret";
  const req = (h?: string) => new Request("http://x/api/cron/fx", { headers: h ? { authorization: h } : {} });
  it("accepts only the exact bearer secret", () => {
    expect(verifyCronAuth(req(`Bearer ${secret}`), secret)).toBe(true);
    expect(verifyCronAuth(req(`Bearer ${secret}x`), secret)).toBe(false);
    expect(verifyCronAuth(req(secret), secret)).toBe(false);
    expect(verifyCronAuth(req(), secret)).toBe(false);
  });
  it("refuses everything when the secret is unset or short", () => {
    expect(verifyCronAuth(req("Bearer "), undefined)).toBe(false);
    expect(verifyCronAuth(req("Bearer short"), "short")).toBe(false);
  });
});
