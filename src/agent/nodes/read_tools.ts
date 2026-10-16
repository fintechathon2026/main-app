// read_tools (architecture §6.3, §6.4): runs side-effect-free tools only. userId comes from
// graph state, which only the route handler sets; it is never taken from LLM arguments.
// Results go back to the Planner as JSON data.

import type { ChatMessage } from "../models/types";
import type { NodeFn } from "./graph-state";
import { getDeps } from "./graph-state";
import { pendingReadCalls } from "./planner";

export const readToolsNode: NodeFn = async (state, config) => {
  const { readTools, now } = getDeps(config);
  const byName = new Map(readTools.map((t) => [t.spec.name, t]));
  const calls = pendingReadCalls(state, new Set(byName.keys()));
  const ctx = { userId: state.userId, now: now() };

  const messages: ChatMessage[] = [];
  for (const call of calls) {
    const tool = byName.get(call.name)!;
    const parsed = tool.argsSchema.safeParse(call.args);
    let content: string;
    if (!parsed.success) {
      content = JSON.stringify({
        error: "invalid_arguments",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    } else {
      try {
        content = JSON.stringify({ tool: call.name, result: await tool.run(parsed.data, ctx) });
      } catch {
        content = JSON.stringify({ error: "tool_failed", tool: call.name });
      }
    }
    messages.push({ role: "tool", toolCallId: call.id, content });
  }
  return { messages };
};
