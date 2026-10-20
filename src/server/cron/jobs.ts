// Owner: R3 (roles.md).
// The cron jobs (architecture §11.1) as plain functions, shared by app/api/cron/* (CRON_SECRET)
// and app/api/admin/run-now (signed-in admin), so both paths run exactly the same code and write
// the same job_runs rows.

import { getPool } from "../db/pool";
import { type DetectResult, pgDetectTx, runDetectForUser } from "../db/read/detect-job";
import { recordJobRun } from "../db/read/detect-store";
import { getReadRepos } from "../db/read/repos";
import { syncFxRates } from "../fx/frankfurter";
import { closeExpiredPausedPlans } from "../plans/expiry";
import { defaultRiskJobDeps, runRiskJobRecorded, type RiskJobStats } from "../risk";

export { runChainSyncJob, ChainSyncNotImplementedError, type ChainSyncStats } from "./chain-sync";
export { cronUserIds } from "./users";

export async function runFxJob() {
  return recordJobRun(getPool(), "fx", () => syncFxRates({ now: new Date().toISOString() }), (r) => ({ stored: r.length }));
}

export type DetectJobResult = (DetectResult | { userId: string; error: string })[];

export async function runDetectJob(userIds: string[]): Promise<DetectJobResult> {
  const now = new Date().toISOString();
  return recordJobRun(
    getPool(),
    "detect",
    async () => {
      const out: DetectJobResult = [];
      for (const userId of userIds) {
        try {
          out.push(await runDetectForUser(userId, now, { repos: getReadRepos(), tx: pgDetectTx }));
        } catch (e) {
          out.push({ userId, error: (e as Error).message });
        }
      }
      return out;
    },
    (r) => ({ users: r.length, failed: r.filter((x) => "error" in x).length }),
  );
}

export type CleanupJobResult = ({ userId: string; closedPlans: number } | { userId: string; error: string })[];

export async function runCleanupJob(userIds: string[]): Promise<CleanupJobResult> {
  return recordJobRun(
    getPool(),
    "cleanup",
    async () => {
      const out: CleanupJobResult = [];
      for (const userId of userIds) {
        try {
          out.push({ userId, closedPlans: (await closeExpiredPausedPlans(userId)).length });
        } catch (e) {
          out.push({ userId, error: (e as Error).message });
        }
      }
      return out;
    },
    (r) => ({ users: r.length, failed: r.filter((x) => "error" in x).length }),
  );
}

/** The risk job; `onlyUserId` restricts it to that user's active prepaid plans. */
export async function runRiskJob(opts: { onlyUserId?: string } = {}): Promise<RiskJobStats> {
  const deps = await defaultRiskJobDeps();
  const { onlyUserId } = opts;
  if (onlyUserId) {
    const repo = deps.repo;
    deps.repo = { ...repo, listActivePlans: async () => (await repo.listActivePlans()).filter((p) => p.userId === onlyUserId) };
  }
  return runRiskJobRecorded(deps);
}
