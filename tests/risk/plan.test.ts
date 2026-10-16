// Attested exit path through the real agent graph (fakes for the store, executor and models):
// registry publish -> risk job -> startPlan(prepaid_risk, subject = prepaid plan) -> Planner
// proposes prepaid_exit(plan_id) -> executor. Soft signals in the same run add nothing.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startPlan, type PlanRegistry, type PlanStatus, type RunEnv } from "@/src/agent/run";
import type { ChatResponse } from "@/src/agent/models/types";
import { CONTEXT_KEY } from "@/src/agent/prompts/planner";
import { runRiskJob } from "@/src/server/risk/job";
import { publishAttestation, resetRegistry } from "@/src/sim/registry/attestations";
import { findSimMerchant } from "@/src/sim/registry/merchants";
import { ScriptedModelClient, harnessWith } from "../agent/fakes";
import { FakeRiskRepo, ORACLE_KEY, PREPAID_PLAN, SIM_KEY, USER, deps, fixedWarning } from "./helpers";

class MemoryPlans implements PlanRegistry {
  rows = new Map<string, { userId: string; trigger: string; subjectId: string | null; status: PlanStatus }>();
  async create({ userId, trigger, subjectId }: { userId: string; trigger: string; subjectId: string | null }) {
    const id = `plan-${this.rows.size + 1}`;
    this.rows.set(id, { userId, trigger, subjectId, status: "running" });
    return id;
  }
  async isOwner(planId: string, userId: string) {
    return this.rows.get(planId)?.userId === userId;
  }
  async claimResume() {
    return false;
  }
  async setStatus(planId: string, _userId: string, status: PlanStatus) {
    const r = this.rows.get(planId);
    if (r) r.status = status;
  }
}

const call = (name: string, args: Record<string, unknown>): ChatResponse => ({
  text: "",
  toolCalls: [{ id: "t1", name, args }],
  stopReason: "tool_use",
});
const say = (text: string): ChatResponse => ({ text, toolCalls: [], stopReason: "end_turn" });

const saved = process.env.SIM_API_KEY;
beforeEach(() => {
  resetRegistry();
  process.env.SIM_API_KEY = SIM_KEY;
});
afterEach(() => {
  process.env.SIM_API_KEY = saved;
});

describe("prepaid_risk plan from a signed attestation", () => {
  it("the Planner proposes prepaid_exit for the subject plan; a re-run starts nothing", async () => {
    await publishAttestation({ merchant: findSimMerchant("FITBOX_FUTIAN")!, kind: "court_enforcement", env: { ORACLE_PRIVATE_KEY: ORACLE_KEY } });

    // Exactly one planner turn pair is scripted: a second plan would fail loudly.
    const h = harnessWith(
      new ScriptedModelClient({
        planner: [call("prepaid_exit", { plan_id: PREPAID_PLAN }), say("Exit proposed after a signed court record.")],
        explainer: [new Error("off")],
      }),
    );
    const plans = new MemoryPlans();
    const runEnv: RunEnv = { graph: h.graph, deps: h.deps, plans };
    const repo = new FakeRiskRepo();
    const job = () =>
      runRiskJob(
        deps({
          repo,
          startPlan: (input) => startPlan(input, runEnv),
          signalReader: fixedWarning({ level: "elevated", summary: "Many complaints this week.", sourceIds: ["sim-cmp-fb-04"] }),
        }),
      );

    const stats = await job();
    expect(stats.errors).toEqual([]);
    expect(stats.plans.started).toEqual([{ planId: "plan-1", prepaidPlanId: PREPAID_PLAN, status: "done" }]);
    expect([...plans.rows.values()]).toEqual([{ userId: USER, trigger: "prepaid_risk", subjectId: PREPAID_PLAN, status: "done" }]);

    const plannerReq = h.models.requests.find((r) => r.role === "planner")!;
    const first = plannerReq.messages[0];
    const ctx = JSON.parse(first.role === "user" ? first.content : "{}");
    expect(ctx[CONTEXT_KEY]).toMatchObject({ trigger: "prepaid_risk", subject_id: PREPAID_PLAN });

    expect(h.world.actions.map((a) => ({ tool: a.tool, args: a.args }))).toEqual([{ tool: "prepaid_exit", args: { plan_id: PREPAID_PLAN } }]);
    expect(h.world.executorCalls).toHaveLength(1);

    const again = await job();
    expect(again.plans.started).toEqual([]);
    expect(again.plans.alreadyTriggered).toBe(1);
    expect(plans.rows.size).toBe(1);
    expect(h.world.actions).toHaveLength(1);
  });
});
