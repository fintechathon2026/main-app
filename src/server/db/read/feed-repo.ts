// Owner: R2 (roles.md). Loads the user's decided `actions` with registry names for the feed.
// Runs in `withUserTx` (RLS) and filters by user. Ids in `args_json` are joined as text, so a
// malformed id cannot raise a cast error; a missing join just leaves the name out. Not exercised
// without a database.

import type { FeedItem, FeedWhyResponse } from "../../api-types";
import { withUserTx } from "../pool";
import { zOrigin } from "./db";
import { FEED_ACTION_STATUSES, type FeedActionRow, buildFeed, buildWhy } from "./feed-view";

export const FEED_LIMIT = 50;

const SELECT = `
  select a.id::text as id, a.tool, a.status, a.decision, a.rule_ids, a.mandate_version,
         a.args_json, a.gate_json, a.result_json,
         coalesce(a.executed_at, a.created_at) as at,
         u.base_currency,
         b.currency as bill_currency, b.due_date::text as bill_due, b.amount_origin as bill_origin, br.name as biller_name,
         sm.canonical_name as sub_merchant, s.amount::float8 as sub_amount, s.currency as sub_currency,
         pm.name as prepaid_merchant, p.unit_price::float8 as unit_price, p.units_total, p.units_redeemed
    from public.actions a
    join public.users u on u.id = a.user_id
    left join public.bills b on b.user_id = a.user_id and b.id::text = a.args_json->>'bill_id'
    left join public.billers br on br.user_id = b.user_id and br.id = b.biller_id
    left join public.subscriptions s on s.user_id = a.user_id and s.id::text = a.args_json->>'subscription_id'
    left join public.merchants sm on sm.id = s.merchant_id
    left join public.prepaid_plans p on p.user_id = a.user_id and p.id::text = a.args_json->>'plan_id'
    left join public.prepaid_merchants pm on pm.id = p.merchant_id
   where a.user_id = $1 and a.status = any($2::text[])`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toRow(r: any): FeedActionRow {
  return {
    id: r.id,
    tool: r.tool,
    status: r.status,
    decision: r.decision,
    ruleIds: r.rule_ids ?? [],
    mandateVersion: Number(r.mandate_version),
    args: r.args_json ?? {},
    gate: r.gate_json,
    result: r.result_json,
    at: r.at instanceof Date ? r.at.toISOString() : new Date(r.at).toISOString(),
    baseCurrency: r.base_currency,
    bill: r.bill_due
      ? { billerName: r.biller_name, currency: r.bill_currency, dueDate: r.bill_due, amountOrigin: zOrigin.catch("user").parse(r.bill_origin) }
      : null,
    subscription: r.sub_merchant ? { merchantName: r.sub_merchant, amount: Number(r.sub_amount), currency: r.sub_currency } : null,
    prepaid: r.prepaid_merchant
      ? { merchantName: r.prepaid_merchant, unitPriceFen: Number(r.unit_price), unitsTotal: r.units_total, unitsRedeemed: r.units_redeemed }
      : null,
  };
}

export async function loadFeed(userId: string, limit = FEED_LIMIT): Promise<FeedItem[]> {
  const rows = await withUserTx(userId, async (tx) => {
    const r = await tx.query(`${SELECT} order by at desc, a.id limit $3`, [userId, [...FEED_ACTION_STATUSES], limit]);
    return r.rows.map(toRow);
  });
  return buildFeed(rows);
}

export async function loadWhy(userId: string, actionId: string): Promise<FeedWhyResponse | null> {
  const row = await withUserTx(userId, async (tx) => {
    const r = await tx.query(`${SELECT} and a.id::text = $3`, [userId, [...FEED_ACTION_STATUSES], actionId]);
    return r.rows[0] ? toRow(r.rows[0]) : null;
  });
  return row ? buildWhy(row) : null;
}
