// Full state of the main graph: the shared PlannerState contract (src/agent/state.ts) plus a few
// bookkeeping channels the graph needs internally. They hold counters, decisions and executor
// results only; never executable arguments.
// TODO(contracts): fold these channels into PlannerState with the owner's review.

import { Annotation, type LangGraphRunnableConfig } from "@langchain/langgraph";
import type { Decision, ExecResult } from "@/src/core/types";
import type { AgentDeps } from "../deps";
import { PlannerState } from "../state";

const replace = <T>(_a: T, b: T) => b;

export const GraphState = Annotation.Root({
  ...PlannerState.spec,
  /** How many entries of `proposed` persist_plan has already handled (indices stay stable across a re-plan). */
  persistedCount: Annotation<number>({ reducer: replace, default: () => 0 }),
  /** Dry-run decisions from gate_preview, by actionId. Routing only. */
  previews: Annotation<Record<string, Decision>>({ reducer: replace, default: () => ({}) }),
  /** Results returned by ActionExecutor.run in the last execute step. */
  execResults: Annotation<ExecResult[]>({ reducer: replace, default: () => [] }),
  /** Set by execute when the executor asked for a re-plan and the budget (max 1) allows it. */
  replanRequested: Annotation<boolean>({ reducer: replace, default: () => false }),
});

export type GraphStateT = typeof GraphState.State;
export type GraphUpdate = typeof GraphState.Update;
export type NodeFn = (state: GraphStateT, config: LangGraphRunnableConfig) => Promise<GraphUpdate>;

/** Dependencies come from server-set graph config, never from state or the LLM. */
export function getDeps(config: LangGraphRunnableConfig): AgentDeps {
  const deps = config.configurable?.deps as AgentDeps | undefined;
  if (!deps) throw new Error("agent graph: config.configurable.deps is missing");
  return deps;
}
