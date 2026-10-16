// execute (architecture §6.3, §8.2): the only node with a side effect on money. It passes
// actionIds, never arguments, to ActionExecutor.run, which reloads the row, re-checks the hash,
// runs the Gate against the active mandate and verifies approvals in Postgres (H1, H2).

import type { ExecResult } from "@/src/core/types";
import { buildReplanMessage } from "../prompts/planner";
import type { NodeFn } from "./graph-state";
import { getDeps } from "./graph-state";

export const MAX_REPLANS = 1;

export const execute: NodeFn = async (state, config) => {
  const { executor } = getDeps(config);
  const execResults: ExecResult[] = [];
  // Sequential on purpose: per-user cap reservations are serialized by the executor anyway.
  for (const id of state.actionIds) execResults.push(await executor.run(id, state.userId));

  const replan = execResults.some((r) => r.replan) && state.replanCount < MAX_REPLANS;
  if (replan) {
    return {
      execResults,
      replanRequested: true,
      replanCount: state.replanCount + 1,
      approvalId: null,
      previews: {},
      messages: [buildReplanMessage()],
      route: "none",
    };
  }
  return { execResults, replanRequested: false, route: "execute" };
};
