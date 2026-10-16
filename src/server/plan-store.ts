// Owner: R2/R3 (roles.md). Minimal version by R1; extend, don't duplicate.
// Postgres implementation of the agent's PlanStore (src/agent/deps.ts). Every query runs in a
// user-scoped transaction (RLS via app.user_id). previewDecision is routing only; the executor
// re-decides at execution time.

import type { AuditRow, PlanStore } from "@/src/agent/deps";
import type { GateResult, Trigger } from "@/src/core/types";
import { actionHash } from "@/src/core/mandate/canonical";
import { withUserTx } from "@/src/server/db/pool";
import { appendAudit } from "@/src/server/audit";
import { createApprovalTx } from "@/src/server/approvals";
import { getExecutor, type ActionExecutor } from "@/src/server/executor";

const AGENT_TOOLS = new Set(["pay_bill", "cancel_subscription", "prepaid_exit", "sweep_to_savings"]);

export class PgPlanStore implements PlanStore {
  constructor(private readonly executor: Pick<ActionExecutor, "preview"> = getExecutor()) {}

  /** Not part of PlanStore: route handlers create the plan row before invoking the graph. */
  async createPlan(input: { userId: string; trigger: Trigger; subjectId?: string | null; plannerModel?: string; planId?: string }): Promise<string> {
    return withUserTx(input.userId, async (tx) => {
      const r = await tx.query(
        `insert into public.plans (id, user_id, trigger, subject_id, planner_model, status)
         values (coalesce($1::uuid, gen_random_uuid()), $2, $3, $4, $5, 'running') returning id`,
        [input.planId ?? null, input.userId, input.trigger, input.subjectId ?? null, input.plannerModel ?? null],
      );
      return r.rows[0].id as string;
    });
  }

  async persistActions(input: Parameters<PlanStore["persistActions"]>[0]): Promise<string[]> {
    return withUserTx(input.userId, async (tx) => {
      const plan = await tx.query("select id from public.plans where id = $1 and user_id = $2", [input.planId, input.userId]);
      if (!plan.rowCount) throw new Error("plan_not_found");
      const ids: string[] = [];
      for (const [idx, a] of input.actions.entries()) {
        if (!AGENT_TOOLS.has(a.tool)) throw new Error(`tool_not_allowed:${a.tool}`);
        // Defense in depth: the stored hash must be sha256(tool + canonical(args)).
        if (actionHash(a.tool, a.args) !== a.argsHash) throw new Error("args_hash_mismatch");
        const r = await tx.query(
          `insert into public.actions (plan_id, user_id, idx, tool, actor, args_json, args_hash, mandate_version, idempotency_key, status)
           values ($1, $2, $3, $4, 'agent', $5, $6, $7, $8, 'planned')
           on conflict (idempotency_key) do update set idempotency_key = excluded.idempotency_key
           returning id, plan_id, args_hash`,
          [input.planId, input.userId, idx, a.tool, JSON.stringify(a.args), a.argsHash, input.mandateVersion, a.idempotencyKey],
        );
        const row = r.rows[0];
        if (row.plan_id !== input.planId || row.args_hash !== a.argsHash) throw new Error("idempotency_key_conflict");
        ids.push(row.id);
      }
      await appendAudit(tx, input.userId, {
        actor: "agent",
        eventType: "plan.persisted",
        data: { planId: input.planId, actionIds: ids, mandateVersion: input.mandateVersion },
      });
      return ids;
    });
  }

  async loadContext(userId: string) {
    return withUserTx(userId, async (tx) => {
      const m = await tx.query("select version, policy_hash from public.mandates where user_id = $1 and status = 'active'", [userId]);
      const k = await tx.query("select enabled from public.kill_switch where user_id = $1", [userId]);
      return {
        mandateVersion: (m.rows[0]?.version as number | undefined) ?? null,
        mandateHash: (m.rows[0]?.policy_hash as string | undefined) ?? null,
        killSwitch: k.rows[0]?.enabled === true,
      };
    });
  }

  previewDecision(actionId: string, userId: string): Promise<GateResult> {
    return this.executor.preview(actionId, userId);
  }

  createApproval(actionId: string, userId: string): Promise<string> {
    return withUserTx(userId, (tx) => createApprovalTx(tx, userId, actionId));
  }

  async recordDeny(actionIds: string[], userId: string): Promise<void> {
    if (actionIds.length === 0) return;
    await withUserTx(userId, async (tx) => {
      const r = await tx.query(
        `update public.actions set status = 'denied', decision = coalesce(decision, 'deny')
          where id = any($1::uuid[]) and user_id = $2 and status in ('planned','ready','awaiting_approval') returning id`,
        [actionIds, userId],
      );
      await appendAudit(tx, userId, { actor: "agent", eventType: "plan.denied", data: { actionIds: r.rows.map((x) => x.id) } });
    });
  }

  async prepaidPlanMerchant(planId: string, userId: string): Promise<string | null> {
    return withUserTx(userId, async (tx) => {
      const r = await tx.query<{ merchant_id: string }>(
        "select merchant_id from public.prepaid_plans where id = $1 and user_id = $2",
        [planId, userId],
      );
      return r.rows[0]?.merchant_id ?? null;
    });
  }

  async auditRowsForPlan(planId: string, userId: string): Promise<AuditRow[]> {
    return withUserTx(userId, async (tx) => {
      const r = await tx.query(
        `select a.id, a.tool, a.status, coalesce(a.decision, a.preview_decision) as decision, a.rule_ids, a.mandate_version,
                a.args_json, a.result_json, u.base_currency, coalesce(b.name, pm.name) as payee_name
           from public.actions a
           join public.users u on u.id = a.user_id
           left join public.billers b on a.tool = 'pay_bill' and b.id = a.args_json->>'biller_id' and b.user_id = a.user_id
           left join public.prepaid_plans pp on a.tool like 'prepaid_%' and pp.id::text = a.args_json->>'plan_id'
           left join public.prepaid_merchants pm on pm.id = pp.merchant_id
          where a.plan_id = $1 and a.user_id = $2
          order by a.idx`,
        [planId, userId],
      );
      return r.rows.map((x) => {
        const result = (x.result_json ?? {}) as Record<string, unknown>;
        const amount = typeof x.args_json?.amount === "number" ? (x.args_json.amount as number) : undefined;
        const txHash = typeof result.txHash === "string" ? result.txHash : typeof result.payment_id === "string" ? result.payment_id : undefined;
        const row: AuditRow = {
          actionId: x.id,
          tool: x.tool,
          decision: x.decision ?? x.status,
          ruleIds: x.rule_ids ?? [],
          mandateVersion: x.mandate_version,
        };
        if (x.payee_name) row.payeeName = x.payee_name;
        if (amount !== undefined) {
          row.amount = amount;
          row.currency = x.base_currency;
        }
        if (txHash) row.txHash = txHash;
        return row;
      });
    });
  }
}
