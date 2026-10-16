// Postgres access for server code (architecture §0.2, §12.1). Plain SQL, no ORM.
// Request paths use DATABASE_URL (pooled, transaction mode). Never service_role here.

import { Pool, type PoolClient } from "pg";

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set");
    pool = new Pool({ connectionString, max: 5 });
  }
  return pool;
}

/** For tests: inject a pool (e.g. local Supabase) or reset between suites. */
export function setPool(p: Pool | null) {
  pool = p;
}

/**
 * Run `fn` in one transaction with `app.user_id` set, so RLS policies scope every query to
 * this user (architecture §12.3). Rolls back on any error.
 */
export async function withUserTx<T>(userId: string, fn: (tx: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.user_id', $1, true)", [userId]);
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
