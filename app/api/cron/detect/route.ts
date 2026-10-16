// Daily detection (architecture §11.1, job `detect`): recurring detection, subscription upserts and
// recommendation scores per user. Protected by CRON_SECRET.
// Users: `REINS_CRON_USER_IDS` (comma-separated UUIDs). TODO(R3): replace with a security-definer
// function that lists active users; reins_server cannot list `users` across RLS.
// TODO(integration): trigger agent proposals (trigger "detector") after the job.

import { connection } from "next/server";
import { isUuid } from "@/src/server/auth/session";
import { verifyCronAuth } from "@/src/server/auth/cron";
import { getPool } from "@/src/server/db/pool";
import { type DetectResult, pgDetectTx, runDetectForUser } from "@/src/server/db/read/detect-job";
import { recordJobRun } from "@/src/server/db/read/detect-store";
import { getReadRepos } from "@/src/server/db/read/repos";

async function run(req: Request): Promise<Response> {
  await connection();
  if (!verifyCronAuth(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const users = (process.env.REINS_CRON_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(isUuid);
  const now = new Date().toISOString();
  try {
    const results = await recordJobRun(
      getPool(),
      "detect",
      async () => {
        const out: (DetectResult | { userId: string; error: string })[] = [];
        for (const userId of users) {
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
    return Response.json({ ok: true, results });
  } catch (e) {
    return Response.json({ error: "detect_failed", detail: (e as Error).message }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
