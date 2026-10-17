// Shared setup for the DB-backed harness tests: fresh Lin-like users (tests/foundations helpers),
// the real stack from tests/e2e/lin.ts, and a Planner stub that proposes whatever the test
// registered for the plan's subject. Each test gets its own user, so files run in parallel.

import type { Pool } from "pg";
import type { ChatRequest, ChatResponse, ModelClient, ToolCall } from "@/src/agent/models/types";
import { CONTEXT_KEY } from "@/src/agent/prompts/planner";
import { startPlan } from "@/src/agent/run";
import { createTestUser, type TestUser } from "../foundations/helpers";
import { drain, summarize, type FlowResult, type LinEnv } from "../e2e/lin";

/** Proposes the registered calls on its first turn for a subject, then answers in prose. */
export class SubjectPlanner implements ModelClient {
  private readonly proposals = new Map<string, Omit<ToolCall, "id">[]>();
  plannerCalls = 0;

  propose(subjectId: string, ...calls: Omit<ToolCall, "id">[]) {
    this.proposals.set(subjectId, calls);
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    if (req.role !== "planner") throw new Error(`no ${req.role} in the harness`); // explain falls back to templates
    this.plannerCalls++;
    const first = req.messages[0];
    const subject = first?.role === "user" ? (JSON.parse(first.content)[CONTEXT_KEY]?.subject_id as string | null) : null;
    const turn = req.messages.filter((m) => m.role === "assistant").length;
    const calls = (subject && this.proposals.get(subject)) || [];
    if (turn === 0 && calls.length) {
      return { text: "", toolCalls: calls.map((c, i) => ({ id: `toolu_h_${i}`, ...c })), stopReason: "tool_use" };
    }
    return { text: "Proposed for review.", toolCalls: [], stopReason: "end_turn" };
  }

  async structured<T>(): Promise<T> {
    throw new Error("no structured calls in the harness");
  }
}

export type PausedPlan = { user: TestUser; billId: string; flow: FlowResult; actionId: string };

/** A user with an anomalous ¥612 electricity bill and a plan paused at await_approval for it. */
export async function pausedBillPlan(admin: Pool, env: LinEnv, planner: SubjectPlanner, user?: TestUser, amount = 612): Promise<PausedPlan> {
  const key = `power${amount}`;
  const u = user ?? (await createTestUser(admin, [{ biller: "SZ_POWER", amount, key }]));
  const billId = u.bills[key];
  planner.propose(billId, { name: "pay_bill", args: { bill_id: billId, biller_id: "SZ_POWER", amount } });
  const flow = summarize(await drain(startPlan({ userId: u.id, trigger: "due_date", subjectId: billId }, env)));
  if (!flow.approvalId) throw new Error(`expected a paused plan, got ${JSON.stringify(flow.events.at(-1))}`);
  const a = await admin.query("select id from public.actions where plan_id = $1", [flow.planId]);
  return { user: u, billId, flow, actionId: a.rows[0].id };
}

export async function paymentsFor(admin: Pool, billId: string) {
  return (await admin.query("select id, amount::int as amount from mockbank.payments where bill_id = $1", [billId])).rows;
}

export async function actionRow(admin: Pool, actionId: string) {
  return (await admin.query("select status, decision, rule_ids from public.actions where id = $1", [actionId])).rows[0];
}

export async function approvalStatus(admin: Pool, approvalId: string) {
  return (await admin.query("select status from public.approvals where id = $1", [approvalId])).rows[0].status as string;
}
