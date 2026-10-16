// persist_plan (architecture §6.3, PRD H4): validates captured calls with the strict action
// schemas, canonicalizes args, and inserts action rows with a deterministic idempotency key.
// This is the only path from LLM output to an executable action, and it carries IDs and
// amounts only; the executor re-derives everything else from the database.

import { actionHash, sha256Hex } from "@/src/core/mandate/canonical";
import { actionArgsSchemas, isAgentActionTool } from "../tools/action-schemas";
import type { NodeFn } from "./graph-state";
import { getDeps } from "./graph-state";

export { sha256Hex };

/** args_hash = sha256(tool + canonical(args)); one implementation shared with the executor. */
export function argsHash(tool: string, args: Record<string, unknown>): string {
  return actionHash(tool, args);
}

/** idempotency_key = sha256(planId + ":" + index); index is the position in `proposed`. */
export function idempotencyKey(planId: string, index: number): string {
  return sha256Hex(`${planId}:${index}`);
}

export const persistPlan: NodeFn = async (state, config) => {
  const { store } = getDeps(config);
  const offset = state.persistedCount;
  const fresh = state.proposed.slice(offset);
  if (fresh.length === 0) return { actionIds: [], persistedCount: state.proposed.length };
  if (state.mandateVersion === null) throw new Error("persist_plan: no mandate version in state");

  const actions: { tool: string; args: Record<string, unknown>; argsHash: string; idempotencyKey: string }[] = [];
  const feed: string[] = [];
  fresh.forEach((call, i) => {
    const index = offset + i;
    if (!isAgentActionTool(call.name)) {
      feed.push("A proposed action was rejected: it is not an action the agent may propose.");
      return;
    }
    const parsed = actionArgsSchemas[call.name].safeParse(call.args);
    if (!parsed.success) {
      feed.push(`A proposed ${call.name} was rejected: its arguments did not match the allowed schema.`);
      return;
    }
    const args = parsed.data as Record<string, unknown>;
    actions.push({
      tool: call.name,
      args,
      argsHash: argsHash(call.name, args),
      idempotencyKey: idempotencyKey(state.planId, index),
    });
  });

  const actionIds = actions.length
    ? await store.persistActions({ planId: state.planId, userId: state.userId, mandateVersion: state.mandateVersion, actions })
    : [];
  return { actionIds, persistedCount: state.proposed.length, feed };
};
