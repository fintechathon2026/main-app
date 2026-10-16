// Stored recommendations (PRD §13 `recommendations`), written by cron/detect. `signals_json` holds
// the fired signals exactly as `scoreSubscription` produced them.

import { z } from "zod";
import { type Queryable, parseRows, zNum, zOrigin, zTs } from "./db";

export const StoredSignal = z.object({
  key: z.enum(["duplicate", "price_increase", "trial_converted", "low_usage", "fx_cost_high", "high_share"]),
  points: z.number(),
  detail: z.string(),
  source: z.object({ origin: zOrigin, sourceId: z.string().optional(), simulated: z.boolean().optional() }),
});

export const RecommendationRow = z.object({
  id: z.string(),
  subscription_id: z.string(),
  score: zNum,
  signals_json: z.array(StoredSignal),
  status: z.enum(["open", "accepted", "dismissed"]),
  created_at: zTs.nullable(),
});
export type RecommendationRow = z.output<typeof RecommendationRow>;

export async function listRecommendations(q: Queryable, userId: string): Promise<RecommendationRow[]> {
  const { rows } = await q.query(
    `select r.id::text as id, r.subscription_id::text as subscription_id, r.score::text as score,
            r.signals_json, r.status, r.created_at::text as created_at
       from public.recommendations r
      where r.user_id = $1
      order by (r.status = 'open') desc, r.score desc, r.id`,
    [userId],
  );
  return parseRows(RecommendationRow, rows, "recommendations");
}
