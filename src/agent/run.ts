// Starting and resuming plans (architecture §6.6). One plan per trigger; thread_id = planId.
// A run is one HTTP request: it executes until END or interrupt(), then returns. userId always
// comes from the caller's session (route handler) or the scheduler, never from a request body
// or the LLM (H8). Resume carries no authority (H2): it only lets the graph continue to
// `execute`, where the executor checks the approval in Postgres.

import { Command } from "@langchain/langgraph";
import type { Trigger } from "@/src/core/types";
import type { ChatStreamEvent, ResumeResponse } from "@/src/server/api-types";
import { withUserTx } from "@/src/server/db/pool";
import type { AgentDeps } from "./deps";
import { RECURSION_LIMIT, type AgentGraph, type GraphStateT } from "./graph";

export type PlanStatus = "running" | "paused" | "done" | "failed";

/** Rows in public.plans. Every method is scoped to the session user. */
export interface PlanRegistry {
  create(input: { userId: string; trigger: Trigger; subjectId: string | null }): Promise<string>;
  isOwner(planId: string, userId: string): Promise<boolean>;
  /** paused -> running, atomically. False if the plan is not paused (already resumed or finished). */
  claimResume(planId: string, userId: string): Promise<boolean>;
  setStatus(planId: string, userId: string, status: PlanStatus): Promise<void>;
}

export type RunEnv = { graph: AgentGraph; deps: AgentDeps; plans: PlanRegistry };

export type StartPlanInput = {
  userId: string;
  trigger: Trigger;
  subjectId?: string | null;
  documentIds?: string[];
  message?: string;
};

export class PlanNotFoundError extends Error {
  constructor() {
    super("plan not found");
    this.name = "PlanNotFoundError";
  }
}

function runConfig(planId: string, deps: AgentDeps) {
  return { configurable: { thread_id: planId, deps }, recursionLimit: RECURSION_LIMIT };
}

type UpdateChunk = Record<string, unknown> & { __interrupt__?: { value?: { approvalId?: string | null } }[] };

/** Streams one graph run as ChatStreamEvents and returns the final plan status. */
async function* streamRun(
  env: RunEnv,
  planId: string,
  userId: string,
  input: Parameters<AgentGraph["stream"]>[0],
): AsyncGenerator<ChatStreamEvent, PlanStatus> {
  const config = runConfig(planId, env.deps);
  try {
    const stream = await env.graph.stream(input, { ...config, streamMode: "updates" });
    for await (const raw of stream) {
      const chunk = raw as UpdateChunk;
      for (const [node, update] of Object.entries(chunk)) {
        if (node === "__interrupt__") {
          const approvalId = chunk.__interrupt__?.[0]?.value?.approvalId;
          if (approvalId) yield { type: "approval_required", planId, approvalId };
          continue;
        }
        yield { type: "status", node };
        const feed = (update as Partial<GraphStateT> | null)?.feed;
        for (const text of feed ?? []) yield { type: "feed", text };
      }
    }
    const snapshot = await env.graph.getState(config);
    const state = snapshot.values as GraphStateT;
    const status: PlanStatus = snapshot.next.length ? "paused" : "done";
    await env.plans.setStatus(planId, userId, status);
    yield { type: "done", planId, route: state.route };
    return status;
  } catch (e) {
    console.error(JSON.stringify({ msg: "agent run failed", planId, error: e instanceof Error ? e.message : String(e) }));
    await env.plans.setStatus(planId, userId, "failed").catch(() => {});
    yield { type: "error", message: "The agent run failed." };
    return "failed";
  }
}

/** Creates a plan row and runs the graph for it. The first event names the plan. */
export async function* startPlan(input: StartPlanInput, env?: RunEnv): AsyncGenerator<ChatStreamEvent> {
  const runEnv = env ?? (await import("./wiring")).getRunEnv();
  const subjectId = input.subjectId ?? null;
  const planId = await runEnv.plans.create({ userId: input.userId, trigger: input.trigger, subjectId });
  yield { type: "plan", planId };
  yield* streamRun(runEnv, planId, input.userId, {
    userId: input.userId,
    planId,
    trigger: input.trigger,
    subjectId,
    documentIds: input.documentIds ?? [],
    messages: input.message ? [{ role: "user", content: input.message }] : [],
  });
}

/**
 * Resumes a paused plan after the user decided on its approval (via /api/approvals). Checks
 * ownership first. The resume value is ignored by the graph; nothing in it is authority.
 */
export async function resumePlan(input: { planId: string; userId: string }, env?: RunEnv): Promise<ResumeResponse> {
  const runEnv = env ?? (await import("./wiring")).getRunEnv();
  const { planId, userId } = input;
  if (!(await runEnv.plans.isOwner(planId, userId))) throw new PlanNotFoundError();

  const config = runConfig(planId, runEnv.deps);
  const before = await runEnv.graph.getState(config);
  if (!before.next.length) return { planId, status: "done", feed: [] };
  if (!(await runEnv.plans.claimResume(planId, userId))) {
    // Another request already resumed it, or it is no longer paused.
    return { planId, status: "done", feed: [] };
  }

  const approvalId = (before.values as GraphStateT).approvalId;
  const feed: string[] = [];
  const it = streamRun(runEnv, planId, userId, new Command({ resume: { approvalId } }));
  let status: PlanStatus = "failed";
  for (;;) {
    const r = await it.next();
    if (r.done) {
      status = r.value;
      break;
    }
    if (r.value.type === "feed") feed.push(r.value.text);
  }
  return { planId, status: status === "running" ? "paused" : status, feed };
}

/** PlanRegistry over public.plans, scoped by RLS through app.user_id (architecture §12.3). */
export const pgPlanRegistry: PlanRegistry = {
  create: ({ userId, trigger, subjectId }) =>
    withUserTx(userId, async (tx) => {
      const r = await tx.query<{ id: string }>(
        "insert into public.plans (user_id, trigger, subject_id, planner_model, status) values ($1, $2, $3, $4, 'running') returning id",
        [userId, trigger, subjectId, process.env.REINS_PLANNER_MODEL || "claude-sonnet-5-5"],
      );
      return r.rows[0].id;
    }),
  isOwner: (planId, userId) =>
    withUserTx(userId, async (tx) => {
      const r = await tx.query("select 1 from public.plans where id = $1 and user_id = $2", [planId, userId]);
      return r.rowCount === 1;
    }),
  claimResume: (planId, userId) =>
    withUserTx(userId, async (tx) => {
      const r = await tx.query(
        "update public.plans set status = 'running' where id = $1 and user_id = $2 and status = 'paused' returning id",
        [planId, userId],
      );
      return r.rowCount === 1;
    }),
  setStatus: (planId, userId, status) =>
    withUserTx(userId, async (tx) => {
      await tx.query("update public.plans set status = $3 where id = $1 and user_id = $2", [planId, userId, status]);
    }),
};
