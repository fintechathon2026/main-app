// gate_preview, create_approval, await_approval and record_deny (architecture §6.3).
// gate_preview is a dry run that only picks the next node; it is not a security boundary
// (H1): execute always goes through ActionExecutor, which calls the Gate itself.

import { interrupt } from "@langchain/langgraph";
import type { Decision } from "@/src/core/types";
import type { NodeFn } from "./graph-state";
import { getDeps } from "./graph-state";

export const gatePreview: NodeFn = async (state, config) => {
  const { store } = getDeps(config);
  const previews: Record<string, Decision> = {};
  for (const id of state.actionIds) previews[id] = (await store.previewDecision(id, state.userId)).decision;
  const decisions = Object.values(previews);
  const route = decisions.includes("require_confirm") ? "approve" : decisions.includes("allow") ? "execute" : "deny";
  return { previews, route };
};

/** Inserts the pending approval rows. Runs before await_approval so a resume never repeats it (H3). */
export const createApproval: NodeFn = async (state, config) => {
  const { store } = getDeps(config);
  const ids: string[] = [];
  for (const id of state.actionIds) {
    if (state.previews[id] === "require_confirm") ids.push(await store.createApproval(id, state.userId));
  }
  return { approvalId: ids[0] ?? null };
};

/**
 * Contains only interrupt() (H3). The resume value is ignored: it carries no authority (H2).
 * Approval status is checked by the executor in Postgres.
 */
export const awaitApproval: NodeFn = async (state) => {
  interrupt({ approvalId: state.approvalId });
  return {};
};

export const recordDeny: NodeFn = async (state, config) => {
  const { store } = getDeps(config);
  await store.recordDeny(state.actionIds, state.userId);
  return { route: "deny" };
};
