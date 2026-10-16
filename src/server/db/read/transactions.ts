// Transactions (PRD §13 `transactions`), scoped to the user through `accounts.user_id`.
// Sign convention (assumed, see report): `amount < 0` is money out, `amount > 0` is money in.

import { z } from "zod";
import { type Queryable, parseRows, zDay, zNum, zNumOrNull, zOrigin, zTs } from "./db";

export const TransactionRow = z.object({
  id: z.string(),
  account_id: z.string(),
  posted_at: zTs,
  amount: zNum,
  currency: z.string(),
  raw_descriptor: z.string().nullable(),
  original_amount: zNumOrNull,
  original_currency: z.string().nullable(),
  fx_rate: zNumOrNull,
  fx_rate_date: zDay.nullable(),
  merchant_id: z.string().nullable(),
  merchant_name: z.string().nullable(),
  category: z.string().nullable(),
  source_id: z.string().nullable(),
  origin: zOrigin,
});
export type TransactionRow = z.output<typeof TransactionRow>;

export const MAX_TRANSACTIONS = 1000;

export async function listTransactions(
  q: Queryable,
  userId: string,
  f: { from: string; to: string; merchant?: string | null },
): Promise<TransactionRow[]> {
  const { rows } = await q.query(
    `select t.id::text as id, t.account_id::text as account_id, t.posted_at::text as posted_at,
            t.amount::text as amount, t.currency, t.raw_descriptor,
            t.original_amount::text as original_amount, t.original_currency,
            t.fx_rate::text as fx_rate, t.fx_rate_date::text as fx_rate_date,
            t.merchant_id::text as merchant_id, m.canonical_name as merchant_name, m.category,
            t.source_id, t.origin
       from public.transactions t
       join public.accounts a on a.id = t.account_id
       left join public.merchants m on m.id = t.merchant_id
      where a.user_id = $1
        and t.posted_at >= $2::date
        and t.posted_at < ($3::date + 1)
        and ($4::text is null or t.merchant_id::text = $4 or m.canonical_name ilike '%' || $4 || '%')
      order by t.posted_at, t.id
      limit ${MAX_TRANSACTIONS}`,
    [userId, f.from, f.to, f.merchant ?? null],
  );
  return parseRows(TransactionRow, rows, "transactions");
}
