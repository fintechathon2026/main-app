// The risk job: hard signals (attestations) may start a prepaid_risk plan; soft signals only
// warn (architecture §11.1, §24.10; PRD §15.12). See ./job.ts.

import { startPlan } from "@/src/agent/run";
import { attestationDomainFromEnv } from "@/src/sim/registry/eip712";
import { createPgRiskRepo, finishJobRun, startJobRun } from "./repo";
import { createHttpRegistryClient } from "./registry-client";
import { runRiskJob, type RiskJobDeps, type RiskJobStats } from "./job";

export { runRiskJob, type RiskJobDeps, type RiskJobStats, type RiskRepo, type RegistryClient } from "./job";
export { AttestationWire, freshness, recoverAttestationSigner, verifyAttestation, CONTRACT_MAX_AGE_DAYS } from "./attestation";
export { createHttpRegistryClient } from "./registry-client";
export { createPgRiskRepo } from "./repo";

/** Production dependencies: Postgres, the registry over HTTP, the agent's Signal Reader. */
export async function defaultRiskJobDeps(): Promise<RiskJobDeps> {
  const { getAgentDeps } = await import("@/src/agent/wiring");
  return {
    repo: createPgRiskRepo(),
    registry: createHttpRegistryClient({
      baseUrl: process.env.SIM_BASE_URL ?? "http://localhost:3000",
      apiKey: process.env.SIM_API_KEY,
    }),
    signalReader: getAgentDeps().signalReader,
    startPlan: (input) => startPlan(input),
    domain: attestationDomainFromEnv(),
    oracleAddress: process.env.ORACLE_ADDRESS ?? null,
    signalsSimulated: true,
  };
}

/** One run with job_runs bookkeeping. */
export async function runRiskJobRecorded(deps?: RiskJobDeps): Promise<RiskJobStats> {
  const runId = await startJobRun("risk");
  try {
    const stats = await runRiskJob(deps ?? (await defaultRiskJobDeps()));
    await finishJobRun(runId, stats.errors.length ? "failed" : "succeeded", stats);
    return stats;
  } catch (e) {
    await finishJobRun(runId, "failed", null, e instanceof Error ? e.message : String(e)).catch(() => {});
    throw e;
  }
}
