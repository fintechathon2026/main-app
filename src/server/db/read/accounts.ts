// Accounts and balances (PRD §13 `accounts`). Origin: mock_bank (architecture §10.1).

import { z } from "zod";
import { type Queryable, parseRows, zNum, zTs } from "./db";

export const AccountRow = z.object({
  id: z.string(),
  provider: z.string().nullable(),
  type: z.string().nullable(),
  currency: z.string(),
  balance: zNum,
  updated_at: zTs.nullable(),
});
export type AccountRow = z.output<typeof AccountRow>;

export async function getAccounts(q: Queryable, userId: string): Promise<AccountRow[]> {
  const { rows } = await q.query(
    `select a.id::text as id, a.provider, a.type, a.currency, a.balance::text as balance,
            a.updated_at::text as updated_at
       from public.accounts a
      where a.user_id = $1
      order by a.id`,
    [userId],
  );
  return parseRows(AccountRow, rows, "accounts");
}
