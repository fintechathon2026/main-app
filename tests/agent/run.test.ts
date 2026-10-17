import { describe, expect, it } from "vitest";
import type { ChatStreamEvent } from "@/src/server/api-types";
import { PlanNotFoundError, resumePlan, startPlan, type PlanRegistry, type PlanStatus, type RunEnv } from "@/src/agent/run";
import { ScriptedModelClient, USER, harnessWith } from "./fakes";

const OTHER = "33333333-3333-4333-8333-333333333333";

class MemoryPlans implements PlanRegistry {
  rows = new Map<string, { userId: string; status: PlanStatus }>();
  async create({ userId }: { userId: string }) {
    const id = `plan-${this.rows.size + 1}`;
    this.rows.set(id, { userId, status: "running" });
    return id;
  }
  async isOwner(planId: string, userId: string) {
    return this.rows.get(planId)?.userId === userId;
  }
  async claimResume(planId: string, userId: string) {
    const r = this.rows.get(planId);
    if (!r || r.userId !== userId || r.status !== "paused") return false;
    r.status = "running";
    return true;
  }
  pending = new Set<string>();
  async hasPendingApproval(planId: string) {
    return this.pending.has(planId);
  }
  async setStatus(planId: string, userId: string, status: PlanStatus) {
    const r = this.rows.get(planId);
    if (r && r.userId === userId) r.status = status;
  }
}

function env() {
  const h = harnessWith(
    new ScriptedModelClient({
      planner: [
        { text: "", toolCalls: [{ id: "t1", name: "cancel_subscription", args: { subscription_id: "sub_9" } }], stopReason: "tool_use" },
        { text: "Proposed.", toolCalls: [], stopReason: "end_turn" },
      ],
      explainer: [new Error("off")],
    }),
  );
  const plans = new MemoryPlans();
  const runEnv: RunEnv = { graph: h.graph, deps: h.deps, plans };
  return { h, plans, runEnv };
}

async function collect(it: AsyncIterable<ChatStreamEvent>) {
  const out: ChatStreamEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

describe("startPlan / resumePlan", () => {
  it("streams plan, status and approval events, then pauses", async () => {
    const { plans, runEnv } = env();
    const events = await collect(startPlan({ userId: USER, trigger: "chat", message: "cancel sub_9" }, runEnv));
    expect(events[0]).toEqual({ type: "plan", planId: "plan-1" });
    expect(events).toContainEqual({ type: "status", node: "persist_plan" });
    expect(events).toContainEqual({ type: "approval_required", planId: "plan-1", approvalId: "appr-1" });
    expect(events.at(-1)).toEqual({ type: "done", planId: "plan-1", route: "approve" });
    expect(plans.rows.get("plan-1")?.status).toBe("paused");
  });

  it("refuses to resume another user's plan", async () => {
    const { h, runEnv } = env();
    await collect(startPlan({ userId: USER, trigger: "chat", message: "cancel sub_9" }, runEnv));
    await expect(resumePlan({ planId: "plan-1", userId: OTHER }, runEnv)).rejects.toBeInstanceOf(PlanNotFoundError);
    expect(h.world.executorCalls).toHaveLength(0);
  });

  it("double resume executes once", async () => {
    const { h, plans, runEnv } = env();
    // Thread id is the plan id the registry assigned.
    await collect(startPlan({ userId: USER, trigger: "chat", message: "cancel sub_9" }, runEnv));
    h.world.approveAll();
    const [a, b] = await Promise.all([
      resumePlan({ planId: "plan-1", userId: USER }, runEnv),
      resumePlan({ planId: "plan-1", userId: USER }, runEnv),
    ]);
    const third = await resumePlan({ planId: "plan-1", userId: USER }, runEnv);
    expect(h.world.executorCalls).toHaveLength(1);
    expect(h.world.settlements).toHaveLength(1);
    expect([a.status, b.status, third.status]).toEqual(["done", "done", "done"]);
    expect([...a.feed, ...b.feed]).toContain("Cancel: allowed by §subscriptions.cancel v3. tx 0xabcdef12…");
    expect(plans.rows.get("plan-1")?.status).toBe("done");
  });
});
