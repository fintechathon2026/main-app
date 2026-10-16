// Bills (PRD §13 `bills`) with the biller's registry name. The payee account reference is never
// selected: read tools have no reason to see it (FR4.5).
// Amount origin (architecture §10.3): `document` when the bill came from a document, else
// `mock_bank`.

import { z } from "zod";
import { type Queryable, parseRows, zDay, zNum, zTs } from "./db";

export const BillRow = z.object({
  id: z.string(),
  biller_id: z.string(),
  biller_name: z.string().nullable(),
  amount: zNum,
  due_date: zDay,
  period: z.string().nullable(),
  document_id: z.string().nullable(),
  status: z.string(),
  created_at: zTs.nullable(),
});
export type BillRow = z.output<typeof BillRow>;

export const billOrigin = (b: Pick<BillRow, "document_id">) => (b.document_id ? "document" : "mock_bank") as "document" | "mock_bank";

export async function listBills(q: Queryable, userId: string, status?: string | null): Promise<BillRow[]> {
  const { rows } = await q.query(
    `select b.id::text as id, b.biller_id, m.canonical_name as biller_name, b.amount::text as amount,
            b.due_date::text as due_date, b.period::text as period, b.document_id::text as document_id,
            b.status, b.created_at::text as created_at
       from public.bills b
       left join public.billers bl on bl.id = b.biller_id and bl.user_id = b.user_id
       left join public.merchants m on m.id = bl.merchant_id
      where b.user_id = $1
        and ($2::text is null or b.status = $2)
      order by b.due_date, b.id`,
    [userId, status ?? null],
  );
  return parseRows(BillRow, rows, "bills");
}
