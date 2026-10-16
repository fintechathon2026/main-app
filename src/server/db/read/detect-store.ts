// Writes for cron/detect: subscription upserts from the recurring detector and the user's open
// recommendations. Lives next to the read side because it persists read-side outputs; it moves no
// money and touches no mandate, payee or action rows. All statements run under withUserTx (RLS).

import type { RecScore } from "@/src/core/algorithms/recommendation";
import type { DetectPlan } from "@/src/core/detectors/subscriptions";
import type { Queryable } from "./db";

export async function applyDetectPlan(q: Queryable, userId: string, plan: Pick<DetectPlan, "inserts" | "updates">): Promise<void> {
  for (const s of plan.inserts) {
    await q.query(
      `insert into public.subscriptions (user_id, merchant_id, cycle_days, amount, currency, billing_currency,
         original_amount, next_renewal, status, first_seen, last_charged, confidence, detection_source, source_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8::date, $9, $10::date, $11::date, $12, 'mock_bank', $13)`,
      [userId, s.merchantId, s.cycleDays, s.amount, s.currency, s.billingCurrency, s.originalAmount, s.nextRenewal, s.status, s.firstSeen, s.lastCharged, s.confidence, s.sourceId],
    );
  }
  for (const u of plan.updates) {
    await q.query(
      `update public.subscriptions
          set status = $3, last_charged = $4::date, next_renewal = $5::date, confidence = $6
        where user_id = $1 and id::text = $2 and detection_source = 'mock_bank' and status in ('active','inactive')`,
      [userId, u.id, u.status, u.lastCharged, u.nextRenewal, u.confidence],
    );
  }
}

/**
 * Replaces the user's open recommendations with the new ranking. Subscriptions the user already
 * accepted or dismissed a recommendation for are left alone.
 */
export async function replaceOpenRecommendations(q: Queryable, userId: string, ranked: readonly RecScore[]): Promise<number> {
  const { rows } = await q.query(
    `select subscription_id::text as subscription_id from public.recommendations
      where user_id = $1 and status in ('accepted','dismissed')`,
    [userId],
  );
  const decided = new Set((rows as { subscription_id: string }[]).map((r) => r.subscription_id));
  await q.query(`delete from public.recommendations where user_id = $1 and status = 'open'`, [userId]);
  let n = 0;
  for (const r of ranked) {
    if (decided.has(r.subscriptionId)) continue;
    await q.query(
      `insert into public.recommendations (user_id, subscription_id, score, signals_json, status)
       values ($1, $2, $3, $4::jsonb, 'open')`,
      [userId, r.subscriptionId, r.score, JSON.stringify(r.signals)],
    );
    n++;
  }
  return n;
}

/** `job_runs` bookkeeping for cron routes (architecture §11.1). System table, no user scope. */
export async function recordJobRun<T>(q: Queryable, job: string, fn: () => Promise<T>, stats: (r: T) => unknown): Promise<T> {
  const { rows } = await q.query(`insert into public.job_runs (job) values ($1) returning id::text as id`, [job]);
  const id = (rows[0] as { id: string }).id;
  try {
    const r = await fn();
    await q.query(`update public.job_runs set status = 'succeeded', finished_at = now(), stats_json = $2::jsonb where id::text = $1`, [
      id,
      JSON.stringify(stats(r)),
    ]);
    return r;
  } catch (e) {
    await q.query(`update public.job_runs set status = 'failed', finished_at = now(), error = $2 where id::text = $1`, [id, (e as Error).message]);
    throw e;
  }
}
