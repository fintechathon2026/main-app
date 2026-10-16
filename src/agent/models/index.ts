// Model client factory (architecture §6.5, §18.3, §19.2). REINS_MODELS selects the mode:
//   live      -> AnthropicModelClient
//   recorded  -> RecordedModelClient over evals/recordings/<scenario>/ (demo, CI, eval)
//   recording -> AnthropicModelClient wrapped by RecordingModelClient
// The scenario comes from REINS_RECORDING_SCENARIO (default "demo_lin").

import type { ModelClients } from "../deps";
import { AnthropicModelClient, modelIdsFromEnv } from "./anthropic";
import { RecordedModelClient } from "./recorded";
import { RecordingModelClient, directorySink } from "./recording";
import type { ModelClient, ModelMode, ModelRole } from "./types";

export { AnthropicModelClient, modelIdsFromEnv } from "./anthropic";
export { RecordedModelClient, RecordingMissError } from "./recorded";
export { RecordingModelClient, directorySink } from "./recording";
export type { Recording } from "./recording-key";

const ROLES: ModelRole[] = ["planner", "reader", "signal_reader", "explainer", "mandate_compiler"];
export const DEFAULT_SCENARIO = "demo_lin";

function parseMode(mode: string | undefined): ModelMode {
  const m = mode ?? "recorded";
  if (m === "live" || m === "recorded" || m === "recording") return m;
  throw new Error(`REINS_MODELS must be live, recorded or recording (got "${m}")`);
}

export function createModelClients(
  mode: string | undefined = process.env.REINS_MODELS,
  opts: { scenario?: string; env?: Record<string, string | undefined> } = {},
): ModelClients {
  const env = opts.env ?? process.env;
  const scenario = opts.scenario ?? env.REINS_RECORDING_SCENARIO ?? DEFAULT_SCENARIO;
  let client: ModelClient;
  switch (parseMode(mode)) {
    case "live":
      client = new AnthropicModelClient(modelIdsFromEnv(env));
      break;
    case "recording":
      client = new RecordingModelClient(new AnthropicModelClient(modelIdsFromEnv(env)), directorySink(scenario));
      break;
    case "recorded":
      client = new RecordedModelClient({ scenario });
      break;
  }
  // One client serves every role: each request names its role, which selects the model ID.
  return Object.fromEntries(ROLES.map((r) => [r, client])) as ModelClients;
}
