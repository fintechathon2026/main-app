// The re-plan edge (PRD §10.6, H9) against the real stack: a paused bill plan, the mandate
// changes to v4, the user approves, and execute cancels the action for a re-plan. The Planner
// proposes the same payment again. The new action gets the next idx, the cancelled action's
// approval no longer blocks a new approval for the same hash, and the payment happens once.
// Skipped without DATABASE_URL.

import type { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ChatRequest, ChatResponse, ModelClient } from "@/src/agent/models/types";
import { CONTEXT_KEY } from "@/src/agent/prompts/planner";
import { resumePlan } from "@/src/agent/run";
import { canonical, hashPolicy } from "@/src/core/mandate/canonical";
import { LIN_MANDATE_V3 } from "@/src/core/mandate/examples";
import { decideApproval } from "@/src/server/approvals";
import { getPool, setPool } from "@/src/server/db/pool";
import { getMockbankPool, setMockbankPool } from "@/src/mockbank/db";
import { DB_ENABLED, adminPool } from "../foundations/helpers";
import { allRoles, createLinEnv, postgresCheckpointer, type LinEnv } from "../e2e/lin";
import { SubjectPlanner, paymentsFor, pausedBillPlan } from "./db";

/** SubjectPlanner that also proposes again when it receives the re-plan message. */
class ReplanningPlanner implements ModelClient {
  constructor(private readonly inner: SubjectPlanner) {}
  replans = 0;
  async chat(req: ChatRequest): Promise<ChatResponse> {
    const last = req.messages.at(-1);
    const isReplan = last?.role === "user" && JSON.parse(last.content)[CONTEXT_KEY]?.replan === true;
    if (!isReplan) return this.inner.chat(req);
    this.replans++;
    // Same proposal as the first turn (same args, so the same args hash).
    const turn0 = await this.inner.chat({ ...req, messages: [req.messages[0]] });
    return { ...turn0, toolCalls: turn0.toolCalls.map((c, i) => ({ ...c, id: `toolu_replan_${i}` })) };
  }
  structured<T>(): Promise<T> {
    throw new Error("no structured calls in the harness");
  }
}

describe.skipIf(!DB_ENABLED)("harness: re-plan after a mandate change (H9)", () => {
  let admin: Pool;
  let saver: PostgresSaver;
  let subjects: SubjectPlanner;
  let planner: ReplanningPlanner;
  let env: LinEnv;

  beforeAll(async () => {
    admin = adminPool();
    saver = await postgresCheckpointer(admin);
    subjects = new SubjectPlanner();
    planner = new ReplanningPlanner(subjects);
    env = createLinEnv({ models: allRoles(planner), saver });
  });

  afterAll(async () => {
    await saver.end();
    await admin.end();
    await getPool().end();
    setPool(null);
    await getMockbankPool().end();
    setMockbankPool(null);
  });

  async function activateV4(userId: string) {
    const policy = JSON.parse(canonical({ ...LIN_MANDATE_V3, version: 4 }));
    await admin.query("update public.mandates set status = 'superseded' where user_id = $1 and status = 'active'", [userId]);
    await admin.query(
      `insert into public.mandates (user_id, version, policy_json, policy_hash, prev_version, signed_at, status, created_via)
       values ($1, 4, $2, $3, 3, now(), 'active', 'edit')`,
      [userId, JSON.stringify(policy), hashPolicy(policy)],
    );
  }

  it("re-plans into new action rows and a fresh approval", async () => {
    const p = await pausedBillPlan(admin, env, subjects);
    await activateV4(p.user.id);
    await decideApproval(p.user.id, p.flow.approvalId!, "approve");

    const r = await resumePlan({ planId: p.flow.planId, userId: p.user.id }, env);
    expect(planner.replans).toBe(1);
    expect(r.status).toBe("paused");

    const actions = await admin.query(
      "select id, idx, status, mandate_version from public.actions where plan_id = $1 order by idx",
      [p.flow.planId],
    );
    expect(actions.rows.map((a) => [a.idx, a.status])).toEqual([
      [0, "cancelled_replan"],
      [1, "awaiting_approval"],
    ]);

    const approvals = await admin.query(
      "select action_id, status from public.approvals where action_id = any($1::uuid[]) order by created_at",
      [actions.rows.map((a) => a.id)],
    );
    expect(approvals.rows).toEqual([
      { action_id: actions.rows[0].id, status: "expired" },
      { action_id: actions.rows[1].id, status: "pending" },
    ]);
    expect(await paymentsFor(admin, p.billId)).toEqual([]);
  });
});
