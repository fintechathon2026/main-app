// load_context (architecture §6.3): mandate version/hash and kill switch from the database for
// the session user. Kill switch on or no active mandate -> record_deny; the Planner never runs.

import type { NodeFn } from "./graph-state";
import { getDeps } from "./graph-state";

export const loadContext: NodeFn = async (state, config) => {
  const { store } = getDeps(config);
  const ctx = await store.loadContext(state.userId);
  const base = { mandateVersion: ctx.mandateVersion, mandateHash: ctx.mandateHash, killSwitch: ctx.killSwitch };
  if (ctx.killSwitch) {
    return { ...base, route: "deny", feed: ["Kill switch is on: the agent did not plan or act."] };
  }
  if (ctx.mandateVersion === null || ctx.mandateHash === null) {
    return { ...base, route: "deny", feed: ["No active mandate: the agent did not plan or act."] };
  }
  return { ...base, route: "none" };
};
