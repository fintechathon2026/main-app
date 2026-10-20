// Owner: R3 (roles.md).
// Users a per-user cron job runs for. Its own module so that jobs (which re-exports it) and the
// jobs it feeds (chain-sync) do not import each other.

import { isUuid } from "../auth/session";
import { getPool } from "../db/pool";

/**
 * An explicit env list wins (demo config, tests); otherwise public.cron_user_ids() (users with an
 * active mandate; a security-definer function, because reins_server cannot list users across RLS).
 * Every per-user step still runs in withUserTx.
 */
export async function cronUserIds(envVar = "REINS_CRON_USER_IDS"): Promise<string[]> {
  const raw = (process.env[envVar] ?? "").trim();
  if (raw) return raw.split(",").map((s) => s.trim()).filter(isUuid);
  const r = await getPool().query<{ id: string }>("select id::text as id from public.cron_user_ids() as id");
  return r.rows.map((x) => x.id);
}
