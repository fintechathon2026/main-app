// planner + capture_actions (architecture §6.3, §6.4). The Planner sees read tools and the
// action schemas. Side-effecting calls are captured into `proposed` as plain data and answered
// with a stub {status:"queued_for_review"}; read calls are left for the read_tools node.

import { actionToolSpecs, isAgentActionTool } from "../tools/action-schemas";
import type { ChatMessage, ToolCall } from "../models/types";
import type { ProposedCall } from "../state";
import { PLANNER_SYSTEM, QUEUED_FOR_REVIEW, buildContextMessage } from "../prompts/planner";
import type { GraphStateT, NodeFn } from "./graph-state";
import { getDeps } from "./graph-state";

export const MAX_PLANNER_TURNS = 8;

export function plannerTurns(state: GraphStateT): number {
  return state.messages.filter((m) => m.role === "assistant").length;
}

/** The exact messages the Planner model receives for the current state. */
export function plannerMessages(state: GraphStateT): ChatMessage[] {
  return [
    buildContextMessage({
      trigger: state.trigger,
      subjectId: state.subjectId,
      mandateVersion: state.mandateVersion,
      extracted: state.extracted,
      warnings: state.warnings,
    }),
    ...state.messages,
  ];
}

export const planner: NodeFn = async (state, config) => {
  const { models, readTools } = getDeps(config);
  if (plannerTurns(state) >= MAX_PLANNER_TURNS) {
    return { feed: ["The planner stopped after too many steps; nothing further was proposed."] };
  }

  const res = await models.planner.chat({
    role: "planner",
    system: PLANNER_SYSTEM,
    messages: plannerMessages(state),
    tools: [...readTools.map((t) => t.spec), ...actionToolSpecs],
  });

  const readNames = new Set(readTools.map((t) => t.spec.name));
  const assistant: ChatMessage = {
    role: "assistant",
    content: res.text,
    ...(res.toolCalls.length ? { toolCalls: res.toolCalls } : {}),
  };
  const proposed: ProposedCall[] = [];
  const stubs: ChatMessage[] = [];
  for (const call of res.toolCalls) {
    if (isAgentActionTool(call.name)) {
      proposed.push({ name: call.name, args: call.args });
      stubs.push({ role: "tool", toolCallId: call.id, content: QUEUED_FOR_REVIEW });
    } else if (!readNames.has(call.name)) {
      stubs.push({ role: "tool", toolCallId: call.id, content: JSON.stringify({ error: "unknown_tool" }) });
    }
  }
  return { messages: [assistant, ...stubs], proposed };
};

/** Read calls from the latest assistant turn that have no tool result yet. */
export function pendingReadCalls(state: GraphStateT, readNames: Set<string>): ToolCall[] {
  let idx = -1;
  for (let i = state.messages.length - 1; i >= 0; i--) {
    if (state.messages[i].role === "assistant") {
      idx = i;
      break;
    }
  }
  if (idx < 0) return [];
  const last = state.messages[idx];
  if (last.role !== "assistant" || !last.toolCalls) return [];
  const answered = new Set(
    state.messages.slice(idx + 1).flatMap((m) => (m.role === "tool" ? [m.toolCallId] : [])),
  );
  return last.toolCalls.filter((c) => readNames.has(c.name) && !answered.has(c.id));
}
