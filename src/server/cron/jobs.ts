// Owner: R3 (roles.md).
// The cron jobs (architecture §11.1) as plain functions, shared by app/api/cron/* (CRON_SECRET)
// and app/api/admin/run-now (signed-in admin), so both paths run exactly the same code and write
// the same job_runs rows.

import { isUuid } from "../auth/session";
import { getPool } from "../db/pool";
import { type DetectResult, pgDetectTx, runDetectForUser } from "../db/read/detect-job";
import { recordJobRun } from "../db/read/detect-store";
import { getReadRepos } from "../db/read/repos";
import { syncFxRates } from "../fx/frankfurter";
import { closeExpiredPausedPlans } from "../plans/expiry";
import { defaultRiskJobDeps, runRiskJobRecorded, type RiskJobStats } from "../risk";

export { runChainSyncJob, ChainSyncNotImplementedError, type ChainSyncStats } from "./chain-sync";

/**
 * Users a per-user job runs for. An explicit env list wins (demo config, tests); otherwise
 * public.cron_user_ids() (users with an active mandate; a security-definer function, because
 * reins_server cannot list users across RLS). Every per-user step still runs in withUserTx.
 */
export async function cronUserIds(envVar = "REINS_CRON_USER_IDS"): Promise<string[]> {
  const raw = (process.env[envVar] ?? "").trim();
  if (raw) return raw.split(",").map((s) => s.trim()).filter(isUuid);
  const r = await getPool().query<{ id: string }>("select id::text as id from public.cron_user_ids() as id");
  return r.rows.map((x) => x.id);
}

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
