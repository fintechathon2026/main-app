// Production wiring of AgentDeps (architecture §6.5, roles.md §4). Route handlers and cron jobs
// get the graph, its dependencies and the plan registry from here; tests build their own.
//
// Owned by other roles and not on this branch yet, so they are typed placeholders that fail
// loudly with "not wired" until integration:
//   store        -> PlanStore from "@/src/server/plan-store"           (R2)
//   executor     -> ActionExecutorPort from "@/src/server/executor/run" (R2)
//   readTools    -> ReadTool[] from "@/src/agent/tools/read"            (R1, read side)
//   reader       -> createDocumentReader({ models, loadDocument, savePiiMap })
//                   from "@/src/agent/nodes/reader" (needs a loadDocument over ingest storage)
//   signalReader -> createSignalReader({ models, fetchSignals })
//                   from "@/src/agent/nodes/signal_reader"
// Swap each placeholder for the real import when it lands; nothing else changes.

import type { ActionExecutorPort } from "@/src/core/types";
import { compileGraph, type AgentGraph } from "./graph";
import { getCheckpointer } from "./checkpointer";
import type { AgentDeps, DocumentReaderPort, PlanStore, SignalReaderPort } from "./deps";
import { createModelClients } from "./models";
import { pgPlanRegistry, type RunEnv } from "./run";
import type { ReadTool } from "./tools/types";

export class NotWiredError extends Error {
  constructor(what: string, from: string) {
    super(`agent wiring: ${what} is not wired yet (expected from ${from} at integration)`);
    this.name = "NotWiredError";
  }
}

/** An object whose every method rejects with NotWiredError. */
function notWired<T extends object>(what: string, from: string): T {
  return new Proxy({} as T, {
    get: (_t, prop) => (prop === "then" ? undefined : () => Promise.reject(new NotWiredError(`${what}.${String(prop)}`, from))),
  });
}

const store = notWired<PlanStore>("PlanStore", "@/src/server/plan-store");
const executor = notWired<ActionExecutorPort>("ActionExecutor", "@/src/server/executor/run");
const reader = notWired<DocumentReaderPort>("DocumentReader", "@/src/agent/nodes/reader (createDocumentReader)");
const signalReader = notWired<SignalReaderPort>("SignalReader", "@/src/agent/nodes/signal_reader (createSignalReader)");
// TODO(integration): replace with the read tools from "@/src/agent/tools/read".
const readTools: ReadTool[] = [];

let deps: AgentDeps | null = null;
let graph: AgentGraph | null = null;

export function getAgentDeps(): AgentDeps {
  if (!deps) {
    deps = {
      models: createModelClients(),
      readTools,
      store,
      executor,
      reader,
      signalReader,
      now: () => new Date().toISOString(),
    };
  }
  return deps;
}

export function getRunEnv(): RunEnv {
  if (!graph) graph = compileGraph(getCheckpointer());
  return { graph, deps: getAgentDeps(), plans: pgPlanRegistry };
}
