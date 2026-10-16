// The agent graph (architecture §6.1, PRD §11.6.1): an explicit StateGraph.
//
// load_context ─► reader? ─► signal_reader? ─► planner ⇄ read_tools
//                                                 │ (captured action calls get a stub result and
//                                                 │  loop back to planner until it stops calling tools)
//                                           persist_plan ─► gate_preview ─┬─► execute ─┬─► explain ─► END
//                                                 │                       │            └─► planner (re-plan, max 1)
//                                                 └─► explain             ├─► create_approval ─► await_approval ─► execute
//                                                                         └─► record_deny ─► explain
//
// Every security property lives in the executor, the Gate and Postgres, not in these edges
// (PRD §11.6, H1). Dependencies are injected through config.configurable.deps.

import { END, START, StateGraph, type BaseCheckpointSaver } from "@langchain/langgraph";
import { GraphState, type GraphStateT } from "./nodes/graph-state";
import { loadContext } from "./nodes/load_context";
import { readDocuments, readSignals } from "./nodes/quarantine";
import { MAX_PLANNER_TURNS, pendingReadCalls, planner, plannerTurns } from "./nodes/planner";
import { readToolsNode } from "./nodes/read_tools";
import { persistPlan } from "./nodes/persist_plan";
import { awaitApproval, createApproval, gatePreview, recordDeny } from "./nodes/decide_route";
import { execute } from "./nodes/execute";
import { explain } from "./nodes/explain";
import type { AgentDeps } from "./deps";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";

export { GraphState } from "./nodes/graph-state";
export type { GraphStateT } from "./nodes/graph-state";

function needsSignals(s: GraphStateT): boolean {
  return s.trigger === "prepaid_risk" && !!s.subjectId;
}

function afterLoadContext(s: GraphStateT) {
  if (s.route === "deny") return "record_deny";
  if (s.documentIds.length) return "reader";
  if (needsSignals(s)) return "signal_reader";
  return "planner";
}

function afterReader(s: GraphStateT) {
  return needsSignals(s) ? "signal_reader" : "planner";
}

/**
 * Read calls pending -> read_tools. A turn whose calls were all answered in place (captured
 * actions, unknown tools) -> back to the planner so it can continue. A turn without tool calls
 * (or the turn budget spent) ends planning.
 */
function afterPlanner(s: GraphStateT, config: LangGraphRunnableConfig) {
  const deps = config.configurable?.deps as AgentDeps | undefined;
  const readNames = new Set((deps?.readTools ?? []).map((t) => t.spec.name));
  if (pendingReadCalls(s, readNames).length) return "read_tools";
  if (plannerTurns(s) >= MAX_PLANNER_TURNS) return "persist_plan";
  const last = [...s.messages].reverse().find((m) => m.role === "assistant");
  return last?.role === "assistant" && last.toolCalls?.length ? "planner" : "persist_plan";
}

function afterPersist(s: GraphStateT) {
  return s.actionIds.length ? "gate_preview" : "explain";
}

function afterPreview(s: GraphStateT) {
  if (s.route === "approve") return "create_approval";
  if (s.route === "execute") return "execute";
  return "record_deny";
}

function afterExecute(s: GraphStateT) {
  return s.replanRequested ? "planner" : "explain";
}

export function buildGraph() {
  return new StateGraph(GraphState)
    .addNode("load_context", loadContext)
    .addNode("reader", readDocuments)
    .addNode("signal_reader", readSignals)
    .addNode("planner", planner)
    .addNode("read_tools", readToolsNode)
    .addNode("persist_plan", persistPlan)
    .addNode("gate_preview", gatePreview)
    .addNode("create_approval", createApproval)
    .addNode("await_approval", awaitApproval)
    .addNode("execute", execute)
    .addNode("record_deny", recordDeny)
    .addNode("explain", explain)
    .addEdge(START, "load_context")
    .addConditionalEdges("load_context", afterLoadContext, ["record_deny", "reader", "signal_reader", "planner"])
    .addConditionalEdges("reader", afterReader, ["signal_reader", "planner"])
    .addEdge("signal_reader", "planner")
    .addConditionalEdges("planner", afterPlanner, ["read_tools", "planner", "persist_plan"])
    .addEdge("read_tools", "planner")
    .addConditionalEdges("persist_plan", afterPersist, ["gate_preview", "explain"])
    .addConditionalEdges("gate_preview", afterPreview, ["create_approval", "execute", "record_deny"])
    .addEdge("create_approval", "await_approval")
    .addEdge("await_approval", "execute")
    .addConditionalEdges("execute", afterExecute, ["planner", "explain"])
    .addEdge("record_deny", "explain")
    .addEdge("explain", END);
}

export function compileGraph(checkpointer: BaseCheckpointSaver) {
  return buildGraph().compile({ checkpointer });
}

export type AgentGraph = ReturnType<typeof compileGraph>;

/** Steps allowed per run: planner turns plus the fixed nodes, with headroom for one re-plan. */
export const RECURSION_LIMIT = 80;
