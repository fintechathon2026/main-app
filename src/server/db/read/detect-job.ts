// cron/detect for one user (architecture §11.1): recurring detection → subscription upserts →
// recommendation scores. Dependencies are injected so the job runs against fakes in tests.
// TODO(integration): start an agent run (trigger "detector") for new proposals once the graph's
// trigger entry point is wired; today the job only refreshes rows the UI and tools read.

import { planSubscriptionUpserts } from "@/src/core/detectors/subscriptions";
import { withUserTx } from "../pool";
import { applyDetectPlan, replaceOpenRecommendations } from "./detect-store";
import type { Queryable } from "./db";
import type { ReadRepos } from "./repos";
import { chargesByMerchant, loadSubscriptionContext, scoreRecommendations } from "./views";

export type DetectResult = { userId: string; inserted: number; updated: number; recommendations: number };

export type DetectDeps = {
  repos: ReadRepos;
  tx: <T>(userId: string, fn: (q: Queryable) => Promise<T>) => Promise<T>;
};

export async function runDetectForUser(userId: string, now: string, deps: DetectDeps): Promise<DetectResult> {
  const d = { repos: deps.repos, userId, now };
  const ctx = await loadSubscriptionContext(d);
  const plan = planSubscriptionUpserts({
    charges: chargesByMerchant(ctx.transactions),
    existing: ctx.subs.map((s) => ({
      id: s.row.id,
      merchantId: s.row.merchant_id,
      status: s.row.status,
      detectionSource: s.row.detection_source,
      billingCurrency: s.row.billing_currency,
    })),
    baseCurrency: ctx.baseCurrency,
    now,
    rateOn: ctx.rateOn,
  });
  await deps.tx(userId, (q) => applyDetectPlan(q, userId, plan));
  const { ranked } = await scoreRecommendations(d);
  const recommendations = await deps.tx(userId, (q) => replaceOpenRecommendations(q, userId, ranked));
  return { userId, inserted: plan.inserts.length, updated: plan.updates.length, recommendations };
}

export const pgDetectTx: DetectDeps["tx"] = (userId, fn) => withUserTx(userId, fn);
