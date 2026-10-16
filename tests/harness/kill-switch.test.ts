// R1-14 / I-06: with the kill switch on, bill, cancel and prepaid actions are all denied
// (architecture §14.5). The graph does not even plan; actions that were already planned are
// denied at execution; an approval granted before or after the switch does not help.
// Skipped without DATABASE_URL.

import { randomUUID } from "node:crypto";
import type { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actionHash } from "@/src/core/mandate/canonical";
import { resumePlan, startPlan } from "@/src/agent/run";
import { decideApproval } from "@/src/server/approvals";
import { getPool, setPool } from "@/src/server/db/pool";
import { getMockbankPool, setMockbankPool } from "@/src/mockbank/db";
import { DB_ENABLED, adminPool, createTestUser } from "../foundations/helpers";
import { allRoles, createLinEnv, drain, postgresCheckpointer, summarize, type LinEnv } from "../e2e/lin";
import { SubjectPlanner, actionRow, pausedBillPlan, paymentsFor } from "./db";

describe.skipIf(!DB_ENABLED)("harness: kill switch denies every action type (I-06)", () => {
  let admin: Pool;
  let saver: PostgresSaver;
  let planner: SubjectPlanner;
  let env: LinEnv;

  beforeAll(async () => {
    admin = adminPool();
    saver = await postgresCheckpointer(admin);
    planner = new SubjectPlanner();
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

  const killSwitch = (userId: string, enabled: boolean) =>
    admin.query("update public.kill_switch set enabled = $2, changed_at = now() where user_id = $1", [userId, enabled]);

  it("with the switch on, a run stops at load_context: the Planner is never called and nothing is planned", async () => {
    const u = await createTestUser(admin, [{ biller: "CHINA_MOBILE", amount: 98, key: "mobile" }]);
    planner.propose(u.bills.mobile, { name: "pay_bill", args: { bill_id: u.bills.mobile, biller_id: "CHINA_MOBILE", amount: 98 } });
    await killSwitch(u.id, true);
    const before = planner.plannerCalls;

    const r = summarize(await drain(startPlan({ userId: u.id, trigger: "due_date", subjectId: u.bills.mobile }, env)));
    expect(r.events.at(-1)).toMatchObject({ type: "done", route: "deny" });
    expect(r.feed).toContain("Kill switch is on: the agent did not plan or act.");
    expect(planner.plannerCalls).toBe(before);
    const actions = await admin.query("select count(*)::int as n from public.actions where plan_id = $1", [r.planId]);
    expect(actions.rows[0].n).toBe(0);
    expect(await paymentsFor(admin, u.bills.mobile)).toEqual([]);
  });

  it("pay_bill, cancel_subscription and prepaid_exit already planned are denied by §global.kill_switch at preview and execution", async () => {
    const u = await createTestUser(admin, [{ biller: "CHINA_MOBILE", amount: 98, key: "mobile" }]);
    const planId = await env.store.createPlan({ userId: u.id, trigger: "chat", subjectId: randomUUID() });
    const calls = [
      { tool: "pay_bill", args: { bill_id: u.bills.mobile, biller_id: "CHINA_MOBILE", amount: 98 } },
      { tool: "cancel_subscription", args: { subscription_id: randomUUID() } },
      { tool: "prepaid_exit", args: { plan_id: randomUUID() } },
    ];
    const ids = await env.store.persistActions({
      planId,
      userId: u.id,
      mandateVersion: 3,
      actions: calls.map((c) => ({ ...c, argsHash: actionHash(c.tool, c.args), idempotencyKey: `test:${randomUUID()}` })),
    });
    await killSwitch(u.id, true);

    for (const id of ids) {
      const preview = await env.store.previewDecision(id, u.id);
      expect(preview).toMatchObject({ decision: "deny", ruleIds: ["global.kill_switch"] });
      const r = await env.executor.run(id, u.id);
      expect(r.status).toBe("denied");
      expect(r.gate?.ruleIds).toEqual(["global.kill_switch"]);
    }
    const settled = await admin.query(
      "select count(*)::int as n from mockbank.operations where idempotency_key in (select idempotency_key from public.actions where plan_id = $1)",
      [planId],
    );
    expect(settled.rows[0].n).toBe(0);
    expect(await paymentsFor(admin, u.bills.mobile)).toEqual([]);
  });

  it("a plan waiting for approval cannot execute after the switch, even once approved", async () => {
    const p = await pausedBillPlan(admin, env, planner);
    await killSwitch(p.user.id, true);
    await decideApproval(p.user.id, p.flow.approvalId!, "approve");

    const r = await resumePlan({ planId: p.flow.planId, userId: p.user.id }, env);
    expect(r.status).toBe("done");
    expect(r.feed.some((l) => /blocked by §global\.kill_switch/.test(l))).toBe(true);
    expect(await paymentsFor(admin, p.billId)).toEqual([]);
    expect(await actionRow(admin, p.actionId)).toMatchObject({ status: "denied", decision: "deny", rule_ids: ["global.kill_switch"] });

    // Turning the switch off again does not revive the denied action.
    await killSwitch(p.user.id, false);
    expect((await env.executor.run(p.actionId, p.user.id)).status).toBe("denied");
    expect(await paymentsFor(admin, p.billId)).toEqual([]);
  });
});
