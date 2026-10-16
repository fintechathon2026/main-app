// Read-side settings from the active mandate (PRD §9.2): base currency, trial auto-cancel timing,
// anomaly parameters. Read only; the LLM never edits mandates (G6). Missing values fall back to
// safe defaults; the Gate does its own strict mandate validation.

import { z } from "zod";
import { type Queryable, zNum } from "./db";

export type UserSettings = {
  baseCurrency: string;
  mandateVersion: number | null;
  autoCancelTrials: { enabled: boolean; daysBeforeCharge: number } | null;
  anomaly: { k: number; minHistory: number };
  renewalNoticeDays: number;
};

export const DEFAULT_BASE_CURRENCY = "CNY";

const Policy = z
  .object({
    base_currency: z.string().optional(),
    bills: z.object({ anomaly: z.object({ k: z.number(), min_history: z.number() }).partial().optional() }).partial().optional(),
    subscriptions: z
      .object({
        renewal_notice_days: z.number(),
        auto_cancel_trials: z.object({ enabled: z.boolean(), days_before_charge: z.number() }).partial(),
      })
      .partial()
      .optional(),
  })
  .loose();

export async function getUserSettings(q: Queryable, userId: string): Promise<UserSettings> {
  const m = await q.query(
    `select version, policy_json from public.mandates where user_id = $1 and status = 'active' limit 1`,
    [userId],
  );
  const a = await q.query(
    `select currency from public.accounts where user_id = $1 order by id limit 1`,
    [userId],
  );
  const row = m.rows[0] as { version?: unknown; policy_json?: unknown } | undefined;
  const policy = Policy.safeParse(row?.policy_json ?? {});
  const p = policy.success ? policy.data : {};
  const acct = (a.rows[0] as { currency?: string } | undefined)?.currency;
  const act = p.subscriptions?.auto_cancel_trials;
  return {
    baseCurrency: p.base_currency ?? acct ?? DEFAULT_BASE_CURRENCY,
    mandateVersion: row?.version != null ? zNum.parse(row.version) : null,
    autoCancelTrials: act?.enabled ? { enabled: true, daysBeforeCharge: act.days_before_charge ?? 1 } : null,
    anomaly: { k: p.bills?.anomaly?.k ?? 3.5, minHistory: p.bills?.anomaly?.min_history ?? 3 },
    renewalNoticeDays: p.subscriptions?.renewal_notice_days ?? 5,
  };
}
