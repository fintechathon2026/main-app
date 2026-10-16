// FX rates (PRD §13 `fx_rates(date, base, quote, rate, source, fetched_at)`). Reference data, not
// user-scoped. Only `source = 'fx_provider'` rows are trusted (FR18.2).

import { z } from "zod";
import { type Queryable, parseRows, zDay, zNum, zTs } from "./db";

export const FxRateRow = z.object({
  date: zDay,
  base: z.string(),
  quote: z.string(),
  rate: zNum,
  source: z.literal("fx_provider"),
  fetched_at: zTs.nullable(),
});
export type FxRateRow = z.output<typeof FxRateRow>;

const COLS = `r.date::text as date, r.base, r.quote, r.rate::text as rate, r.source, r.fetched_at::text as fetched_at`;

/** Latest trusted rate on or before `date` for base→quote. */
export async function getFxRateRow(q: Queryable, base: string, quote: string, date: string): Promise<FxRateRow | null> {
  const { rows } = await q.query(
    `select ${COLS} from public.fx_rates r
      where r.base = $1 and r.quote = $2 and r.date <= $3::date and r.source = 'fx_provider'
      order by r.date desc limit 1`,
    [base, quote, date],
  );
  return parseRows(FxRateRow, rows, "fx_rates")[0] ?? null;
}

/** All trusted rows for base→quote in [from − 7 days, to], for posting-date lookups. */
export async function listFxRates(q: Queryable, base: string, quote: string, from: string, to: string): Promise<FxRateRow[]> {
  const { rows } = await q.query(
    `select ${COLS} from public.fx_rates r
      where r.base = $1 and r.quote = $2 and r.date >= ($3::date - 7) and r.date <= $4::date
        and r.source = 'fx_provider'
      order by r.date`,
    [base, quote, from, to],
  );
  return parseRows(FxRateRow, rows, "fx_rates");
}
