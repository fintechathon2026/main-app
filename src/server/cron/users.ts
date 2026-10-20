// Owner: R3 (roles.md).
// Which users a per-user cron job runs for. Its own module so jobs.ts and chain-sync.ts can both
// use it without importing each other.

import { isUuid } from "../auth/session";
import { getPool } from "../db/pool";

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
