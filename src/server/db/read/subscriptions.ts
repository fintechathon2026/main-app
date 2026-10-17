// Subscriptions and usage signals (PRD §13 `subscriptions`, `usage_signals`).
// `amount` / `currency` are what the account is charged; `billing_currency` / `original_amount`
// carry the foreign billing amount when there is one (FR18.1).

import { z } from "zod";
import { type Queryable, parseRows, zDay, zNum, zNumOrNull, zOrigin, zTs } from "./db";

export const SUBSCRIPTION_STATUSES = ["active", "inactive", "cancelled", "trial"] as const;
export const DETECTION_SOURCES = ["mock_bank", "manual", "email", "csv"] as const;

export const SubscriptionRow = z.object({
  id: z.string(),
  merchant_id: z.string(),
  merchant_name: z.string().nullable(),
  category: z.string().nullable(),
  cycle_days: z.number().int().positive(),
  amount: zNum,
  currency: z.string(),
  next_renewal: zDay.nullable(),
  billing_currency: z.string().nullable(),
  original_amount: zNumOrNull,
  status: z.enum(SUBSCRIPTION_STATUSES),
  first_seen: zDay.nullable(),
  last_charged: zDay.nullable(),
  confidence: zNumOrNull,
  detection_source: z.enum(DETECTION_SOURCES),
  trial_end: zTs.nullable(),
  trial_status_origin: zOrigin.nullable(),
  keep_flag: z.boolean(),
});
export type SubscriptionRow = z.output<typeof SubscriptionRow>;

const SUB_COLUMNS = `s.id::text as id, s.merchant_id::text as merchant_id, m.canonical_name as merchant_name,
       m.category, s.cycle_days, s.amount::text as amount, s.currency, s.next_renewal::text as next_renewal,
       s.billing_currency, s.original_amount::text as original_amount, s.status,
       s.first_seen::text as first_seen, s.last_charged::text as last_charged,
       s.confidence::text as confidence, s.detection_source, s.trial_end::text as trial_end,
       s.trial_status_origin, coalesce(s.keep_flag, false) as keep_flag`;

export async function listSubscriptions(q: Queryable, userId: string, status?: string | null): Promise<SubscriptionRow[]> {
  const { rows } = await q.query(
    `select ${SUB_COLUMNS}
       from public.subscriptions s
       left join public.merchants m on m.id = s.merchant_id
      where s.user_id = $1 and ($2::text is null or s.status = $2)
      order by s.next_renewal nulls last, s.id`,
    [userId, status ?? null],
  );
  return parseRows(SubscriptionRow, rows, "subscriptions");
}

export async function getSubscription(q: Queryable, userId: string, id: string): Promise<SubscriptionRow | null> {
  const { rows } = await q.query(
    `select ${SUB_COLUMNS}
       from public.subscriptions s
       left join public.merchants m on m.id = s.merchant_id
      where s.user_id = $1 and s.id::text = $2`,
    [userId, id],
  );
  return parseRows(SubscriptionRow, rows, "subscriptions")[0] ?? null;
}

export const UsageSignalRow = z.object({
  subscription_id: z.string().nullable(),
  merchant_id: z.string().nullable(),
  source: z.string().nullable(),
  metric: z.string(),
  value: zNumOrNull,
  period_start: zDay.nullable(),
  period_end: zDay.nullable(),
  origin: zOrigin,
  simulated: z.boolean(),
});
export type UsageSignalRow = z.output<typeof UsageSignalRow>;

export async function listUsageSignals(q: Queryable, userId: string): Promise<UsageSignalRow[]> {
  const { rows } = await q.query(
    `select u.subscription_id::text as subscription_id, u.merchant_id::text as merchant_id, u.source,
            u.metric, u.value::text as value, u.period_start::text as period_start,
            u.period_end::text as period_end, u.origin, coalesce(u.simulated, false) as simulated
       from public.usage_signals u
      where u.user_id = $1
      order by u.period_end desc nulls last`,
    [userId],
  );
  return parseRows(UsageSignalRow, rows, "usage_signals");
}

/**
 * The one write in this module: the user's "keep it" on a trial (FR5.7 T3 exception). It moves
 * no money; it only makes the Gate refuse the auto-cancel. Owner-scoped by `user_id` and RLS.
 * Returns "not_found" for a missing or foreign id, "not_trial" for a paid plan.
 */
export async function setTrialKeepFlag(
  q: Queryable,
  userId: string,
  id: string,
): Promise<"ok" | "not_found" | "not_trial"> {
  const { rows } = await q.query(
    `select s.status from public.subscriptions s where s.user_id = $1 and s.id::text = $2 for update`,
    [userId, id],
  );
  const row = rows[0] as { status?: string } | undefined;
  if (!row) return "not_found";
  if (row.status !== "trial") return "not_trial";
  await q.query(`update public.subscriptions set keep_flag = true where user_id = $1 and id::text = $2`, [userId, id]);
  return "ok";
}
