// Body of scripts/record-demo.ts (kept separate so the resolve hook is registered before any
// "@/" import is evaluated). See that file for usage.

import { existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { AnthropicModelClient, modelIdsFromEnv } from "@/src/agent/models/anthropic";
import { RECORDINGS_ROOT, RecordedModelClient } from "@/src/agent/models/recorded";
import { RecordingModelClient, directorySink, type RecordingSink } from "@/src/agent/models/recording";
import type { Recording } from "@/src/agent/models/recording-key";
import type { ModelClient } from "@/src/agent/models/types";
import { getPool, setPool } from "@/src/server/db/pool";
import { getMockbankPool, setMockbankPool } from "@/src/mockbank/db";
import { adminPool } from "../tests/foundations/helpers";
import { DemoScriptModelClient } from "../tests/e2e/demo-script";
import { allRoles, createLinEnv, postgresCheckpointer, restoreLin, runDemoPath, type FlowResult } from "../tests/e2e/lin";
import type { ResumeResponse } from "@/src/server/api-types";

/**
 * Explainer requests that carry a settlement reference (" tx <id>") differ on every run: the mock
 * bank and mock escrow mint a fresh payment id / tx id. They can never be replayed, so they are
 * not written; at replay the Explainer misses and the graph uses the template lines, as designed
 * (src/agent/nodes/explain.ts falls back on any error).
 */
export function isReplayable(rec: Recording): boolean {
  if (rec.kind !== "chat" || rec.role !== "explainer") return true;
  const first = rec.request.messages[0];
  const lines = first?.role === "user" ? ((JSON.parse(first.content) as { lines?: string[] }).lines ?? []) : [];
  return !lines.some((l) => / tx \S+$/.test(l));
}

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function printFlow(name: string, r: FlowResult | ResumeResponse) {
  const errors = "events" in r ? r.events.filter((e) => e.type === "error") : [];
  console.log(`\n== ${name}${"status" in r ? ` (${r.status})` : ""}`);
  for (const line of r.feed) console.log(`   feed: ${line}`);
  for (const e of errors) console.log(`   ERROR: ${e.type === "error" ? e.message : ""}`);
}

export async function main(argv: string[]) {
  const scenario = arg(argv, "--scenario") ?? "demo_lin";
  const live = process.env.REINS_MODELS === "recording";
  for (const v of ["DATABASE_URL", "MOCKBANK_DATABASE_URL", "MOCKBANK_API_KEY"]) {
    if (!process.env[v]) throw new Error(`${v} is not set (load .env.local first)`);
  }
  if (live && !process.env.ANTHROPIC_API_KEY) throw new Error("REINS_MODELS=recording needs ANTHROPIC_API_KEY");

  const dir = path.join(RECORDINGS_ROOT, scenario);
  if (existsSync(dir)) for (const f of readdirSync(dir)) if (f.endsWith(".json")) rmSync(path.join(dir, f));

  const inner: ModelClient = live ? new AnthropicModelClient(modelIdsFromEnv()) : new DemoScriptModelClient();
  const write = directorySink(scenario);
  let written = 0;
  let skipped = 0;
  const sink: RecordingSink = (rec) => {
    if (!isReplayable(rec)) {
      skipped++;
      return;
    }
    write(rec);
    written++;
  };

  const admin = adminPool();
  const saver = await postgresCheckpointer(admin);
  let failures = 0;
  try {
    console.log(`Recording scenario ${scenario} with ${live ? "live Anthropic models" : "hand-written answers (tests/e2e/demo-script.ts)"}`);
    const recordEnv = createLinEnv({ models: allRoles(new RecordingModelClient(inner, sink)), saver });
    await runDemoPath(recordEnv, admin, printFlow);
    console.log(`\nWrote ${written} recordings to ${dir} (${skipped} non-replayable Explainer calls skipped).`);

    // Replay check: the same path from the recordings alone, without any model.
    console.log("\nReplaying from the recordings...");
    const replayEnv = createLinEnv({ models: allRoles(new RecordedModelClient({ scenario })), saver });
    await runDemoPath(replayEnv, admin, (name, r) => {
      printFlow(name, r);
      if ("events" in r && r.events.some((e) => e.type === "error")) failures++;
      if ("status" in r && r.status === "failed") failures++;
    });
    console.log(failures ? `\nReplay FAILED in ${failures} flow(s).` : "\nReplay OK.");
  } finally {
    await restoreLin(admin).catch(() => {});
    await saver.end();
    await admin.end();
    await getPool().end();
    setPool(null);
    await getMockbankPool().end();
    setMockbankPool(null);
  }
  if (failures) process.exitCode = 1;
}
