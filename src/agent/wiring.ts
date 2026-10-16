// Production wiring of AgentDeps (architecture §6.5, roles.md §4). Route handlers and cron jobs
// get the graph, its dependencies and the plan registry from here; tests build their own.
//
//   store        -> PgPlanStore           (minimal R2 version, src/server/plan-store.ts)
//   executor     -> getExecutor()         (minimal R2 version, src/server/executor)
//   reader       -> createDocumentReader  over ingest storage (local dir in dev)
//   signalReader -> createSignalReader    over the registry simulator (SIM_BASE_URL)
//   readTools    -> read side (src/agent/tools/read), wired when it lands

import { PgPlanStore } from "@/src/server/plan-store";
import { getExecutor } from "@/src/server/executor";
import { createPgDocumentRepo } from "@/src/server/ingest/repo";
import { getDocumentStorage } from "@/src/server/ingest/storage";
import { createDocumentLoader } from "@/src/server/ingest/upload";
import { createDocumentReader } from "./nodes/reader";
import { createHttpSignalFetcher, createSignalReader } from "./nodes/signal_reader";
import { compileGraph, type AgentGraph } from "./graph";
import { getCheckpointer } from "./checkpointer";
import type { AgentDeps } from "./deps";
import { createModelClients } from "./models";
import { pgPlanRegistry, type RunEnv } from "./run";
import type { ReadTool } from "./tools/types";

export class NotWiredError extends Error {
  constructor(what: string, from: string) {
    super(`agent wiring: ${what} is not wired yet (expected from ${from} at integration)`);
    this.name = "NotWiredError";
  }
}

// TODO(integration): replace with the read tools from "@/src/agent/tools/read".
const readTools: ReadTool[] = [];

let deps: AgentDeps | null = null;
let graph: AgentGraph | null = null;

export function getAgentDeps(): AgentDeps {
  if (!deps) {
    const models = createModelClients();
    deps = {
      models,
      readTools,
      store: new PgPlanStore(),
      executor: getExecutor(),
      reader: createDocumentReader({
        models,
        // Server-side job: no user token, so documents come from the server storage backend.
        loadDocument: createDocumentLoader({ repo: createPgDocumentRepo(), storage: getDocumentStorage() }),
      }),
      signalReader: createSignalReader({
        models,
        fetchSignals: createHttpSignalFetcher({
          baseUrl: process.env.SIM_BASE_URL ?? "http://localhost:3000",
          apiKey: process.env.SIM_API_KEY,
        }),
      }),
      now: () => new Date().toISOString(),
    };
  }
  return deps;
}

export function getRunEnv(): RunEnv {
  if (!graph) graph = compileGraph(getCheckpointer());
  return { graph, deps: getAgentDeps(), plans: pgPlanRegistry };
}
