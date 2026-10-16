// Paused plans whose approvals expired (architecture §11.2, §8.3). A plan pauses at
// await_approval; if the user never decides, the approval expires and nothing would ever resume
// the plan, so it would hold its (user, trigger, subject) key forever. This closes such plans:
// expired approvals are marked expired, their actions expired, and the plan done. Called by
// cron/cleanup and lazily before a new plan is created for the same key.

import type { PoolClient } from "pg";
import type { Trigger } from "@/src/core/types";
import { withUserTx } from "@/src/server/db/pool";
import { appendAudit } from "@/src/server/audit";

export type PlanKey = { trigger: Trigger; subjectId: string | null };

/** In the caller's transaction (app.user_id set). Returns the ids of the plans closed. */
export async function closeExpiredPausedPlansTx(tx: PoolClient, userId: string, key?: PlanKey): Promise<string[]> {
  const keyFilter = key ? "and p.trigger = $2 and p.subject_id is not distinct from $3" : "";
  const keyArgs = key ? [key.trigger, key.subjectId] : [];

  // Open approvals past expiry, on paused plans in scope.
  const expired = await tx.query<{ id: string; action_id: string }>(
    `update public.approvals ap set status = 'expired'
       from public.actions a join public.plans p on p.id = a.plan_id
      where ap.action_id = a.id and ap.user_id = $1 and p.user_id = $1 and p.status = 'paused' ${keyFilter}
        and ap.status in ('pending','approved') and ap.expires_at <= now()
      returning ap.id, ap.action_id`,
    [userId, ...keyArgs],
  );
  for (const row of expired.rows) {
    await tx.query("update public.actions set status = 'expired' where id = $1 and status = 'awaiting_approval'", [row.action_id]);
    await appendAudit(tx, userId, { actor: "system", eventType: "approval.expired", data: { approvalId: row.id, actionId: row.action_id } });
  }

  // Paused plans with no approval left that the user could still decide.
  const closed = await tx.query<{ id: string }>(
    `update public.plans p set status = 'done'
      where p.user_id = $1 and p.status = 'paused' ${keyFilter}
        and not exists (
          select 1 from public.approvals ap join public.actions a on a.id = ap.action_id
           where a.plan_id = p.id and ap.status in ('pending','approved') and ap.expires_at > now())
      returning p.id`,
    [userId, ...keyArgs],
  );
  for (const row of closed.rows) {
    await appendAudit(tx, userId, { actor: "system", eventType: "plan.expired", data: { planId: row.id } });
  }
  return closed.rows.map((r) => r.id);
}

export function closeExpiredPausedPlans(userId: string, key?: PlanKey): Promise<string[]> {
  return withUserTx(userId, (tx) => closeExpiredPausedPlansTx(tx, userId, key));
}
