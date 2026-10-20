// Owner: R3 (roles.md).
// POST /api/admin/run-now {job} — "Run now" for a cron job (architecture §11.1, admin only).
// Requires a session AND the user id in REINS_ADMIN_USER_IDS (unset = nobody). Per-user jobs
// (detect, cleanup, risk) run only for the signed-in admin's own user id; fx and chain-sync are
// global. Same job functions as app/api/cron/*, so behaviour and job_runs rows are identical.

import { connection } from "next/server";
import { z } from "zod";
import fixture from "@/fixtures/api/run-now.json";
import type { CronJob, RunNowResponse } from "@/src/server/api-types";
import { getSessionUserId } from "@/src/server/auth/session";
import { ChainSyncNotImplementedError, runChainSyncJob, runCleanupJob, runDetectJob, runFxJob, runRiskJob } from "@/src/server/cron/jobs";
import { fixturesEnabled, jsonError } from "@/src/server/db/read/http";

const Body = z.strictObject({ job: z.enum(["fx", "detect", "risk", "cleanup", "chain-sync"]) satisfies z.ZodType<CronJob> });

const NO_STORE = { "cache-control": "no-store" };

function adminIds(): Set<string> {
  return new Set(
    (process.env.REINS_ADMIN_USER_IDS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

const perUser = (r: { userId: string }[]) => ({ users: r.length, failed: r.filter((x) => "error" in x).length });

async function dispatch(job: CronJob, userId: string): Promise<Omit<RunNowResponse, "job" | "ranAt">> {
  switch (job) {
    case "fx": {
      const rows = await runFxJob();
      return { ok: true, scope: "global", stats: { stored: rows.length } };
    }
    case "chain-sync":
      return { ok: true, scope: "global", stats: { ...(await runChainSyncJob()) } };
    case "detect": {
      const stats = perUser(await runDetectJob([userId]));
      return { ok: stats.failed === 0, scope: "user", stats };
    }
    case "cleanup": {
      const stats = perUser(await runCleanupJob([userId]));
      return { ok: stats.failed === 0, scope: "user", stats };
    }
    case "risk": {
      const stats = await runRiskJob({ onlyUserId: userId });
      return { ok: stats.errors.length === 0, scope: "user", stats };
    }
  }
}

export async function POST(req: Request): Promise<Response> {
  await connection();
  if (fixturesEnabled()) return Response.json(fixture, { headers: NO_STORE });
  const userId = await getSessionUserId(req);
  if (!userId) return jsonError(401, "unauthorized");
  if (!adminIds().has(userId.toLowerCase())) return jsonError(403, "forbidden");
  const body = Body.safeParse(await req.json().catch(() => undefined));
  if (!body.success) return jsonError(400, "body must be {job: fx|detect|risk|cleanup|chain-sync}", "bad_request");
  const { job } = body.data;
  const ranAt = new Date().toISOString();
  try {
    const out = await dispatch(job, userId);
    return Response.json({ job, ranAt, ...out } satisfies RunNowResponse, { headers: NO_STORE });
  } catch (e) {
    if (e instanceof ChainSyncNotImplementedError) return jsonError(501, e.code);
    console.error(JSON.stringify({ msg: "admin/run-now failed", job, error: (e as Error).message }));
    return jsonError(500, "job_failed");
  }
}
