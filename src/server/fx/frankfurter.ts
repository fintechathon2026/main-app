// FX reference rates from Frankfurter (ECB reference rates; FR18.2, architecture §10.1).
// Stored in `fx_rates` with `source = 'fx_provider'`; `getRate` serves the latest stored rate on
// or before a date and flags it stale when it is more than 2 days old (the Gate denies on stale).
// `fetch` and the database are injected so tests run offline.

import { z } from "zod";
import { daysBetween } from "@/src/core/detectors/stats";
import { getPool } from "../db/pool";
import type { Queryable } from "../db/read/db";
import { type FxRateRow, getFxRateRow } from "../db/read/fx";

export const FRANKFURTER_URL = "https://api.frankfurter.dev/v1";
export const FX_BASES = ["USD", "EUR"] as const;
export const FX_QUOTES = ["CNY", "IDR"] as const;
export const STALE_AFTER_DAYS = 2;

export type FetchLike = (url: string, init?: RequestInit) => Promise<Pick<Response, "ok" | "status" | "json">>;

const FrankfurterResponse = z.object({
  base: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rates: z.record(z.string(), z.number().positive()),
});
export type FrankfurterResponse = z.infer<typeof FrankfurterResponse>;

export async function fetchFrankfurter(
  base: string,
  quotes: readonly string[],
  opts: { fetchImpl?: FetchLike; date?: string } = {},
): Promise<FrankfurterResponse> {
  const f = opts.fetchImpl ?? (fetch as FetchLike);
  const url = `${FRANKFURTER_URL}/${opts.date ?? "latest"}?base=${encodeURIComponent(base)}&symbols=${quotes.map(encodeURIComponent).join(",")}`;
  const res = await f(url, { headers: { accept: "application/json" }, cache: "no-store" });
  if (!res.ok) throw new Error(`frankfurter: HTTP ${res.status} for ${base}`);
  const body = FrankfurterResponse.parse(await res.json());
  if (body.base !== base) throw new Error(`frankfurter: asked for ${base}, got ${body.base}`);
  return body;
}

export type FxRateInsert = {
  date: string;
  base: string;
  quote: string;
  rate: number;
  source: "fx_provider";
  fetched_at: string;
};

/** Upsert keyed by (date, base, quote); assumes that unique key exists in the migration. */
export async function storeFxRates(q: Queryable, rows: readonly FxRateInsert[]): Promise<void> {
  for (const r of rows) {
    await q.query(
      `insert into public.fx_rates (date, base, quote, rate, source, fetched_at)
       values ($1::date, $2, $3, $4, 'fx_provider', $5::timestamptz)
       on conflict (date, base, quote)
       do update set rate = excluded.rate, source = 'fx_provider', fetched_at = excluded.fetched_at`,
      [r.date, r.base, r.quote, r.rate, r.fetched_at],
    );
  }
}

/** Fetch USD/EUR → CNY/IDR and store them. Returns the stored rows. */
export async function syncFxRates(deps: {
  now: string;
  fetchImpl?: FetchLike;
  store?: (rows: FxRateInsert[]) => Promise<void>;
  bases?: readonly string[];
  quotes?: readonly string[];
}): Promise<FxRateInsert[]> {
  const rows: FxRateInsert[] = [];
  for (const base of deps.bases ?? FX_BASES) {
    const quotes = (deps.quotes ?? FX_QUOTES).filter((q) => q !== base);
    const body = await fetchFrankfurter(base, quotes, { fetchImpl: deps.fetchImpl });
    for (const quote of quotes) {
      const rate = body.rates[quote];
      if (rate === undefined) throw new Error(`frankfurter: no ${base}/${quote} rate`);
      rows.push({ date: body.date, base, quote, rate, source: "fx_provider", fetched_at: deps.now });
    }
  }
  const store = deps.store ?? ((r: FxRateInsert[]) => storeFxRates(getPool(), r));
  await store(rows);
  return rows;
}

export type RateInfo = {
  base: string;
  quote: string;
  rate: number; // quote units per 1 base unit
  rateDate: string;
  source: "fx_provider";
  staleDays: number;
  stale: boolean; // > STALE_AFTER_DAYS old relative to the requested date
  inverted: boolean; // derived from the stored quote→base row
};

export type FxRowLookup = (base: string, quote: string, date: string) => Promise<FxRateRow | null>;

const pgLookup: FxRowLookup = (b, q, d) => getFxRateRow(getPool(), b, q, d);

/**
 * Rate for base→quote on `date` (latest stored on or before it). Falls back to the inverse of a
 * stored quote→base row. Same currency → 1. Null if nothing is stored.
 */
export async function getRate(base: string, quote: string, date: string, lookup: FxRowLookup = pgLookup): Promise<RateInfo | null> {
  const day = date.slice(0, 10);
  if (base === quote) {
    return { base, quote, rate: 1, rateDate: day, source: "fx_provider", staleDays: 0, stale: false, inverted: false };
  }
  let row = await lookup(base, quote, day);
  let inverted = false;
  if (!row) {
    row = await lookup(quote, base, day);
    inverted = !!row;
  }
  if (!row || !(row.rate > 0)) return null;
  const staleDays = daysBetween(row.date, day);
  return {
    base,
    quote,
    rate: inverted ? Math.round((1 / row.rate) * 1e8) / 1e8 : row.rate,
    rateDate: row.date,
    source: "fx_provider",
    staleDays,
    stale: staleDays > STALE_AFTER_DAYS,
    inverted,
  };
}
