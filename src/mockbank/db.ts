// Owner: R3 (roles.md). Minimal version by R1; extend, don't duplicate.
// Mock bank database access. Connects as reins_mockbank (MOCKBANK_DATABASE_URL), which can only
// see the `mockbank` schema. The app never reaches these tables except over /mockbank HTTP.

import { Pool, type PoolClient } from "pg";

let pool: Pool | null = null;

export function getMockbankPool(): Pool {
  if (!pool) {
    const connectionString = process.env.MOCKBANK_DATABASE_URL;
    if (!connectionString) throw new Error("MOCKBANK_DATABASE_URL is not set");
    pool = new Pool({ connectionString, max: 5 });
  }
  return pool;
}

/** For tests: inject or reset the pool. */
export function setMockbankPool(p: Pool | null) {
  pool = p;
}

export async function mbTx<T>(fn: (tx: PoolClient) => Promise<T>): Promise<T> {
  const client = await getMockbankPool().connect();
  try {
    await client.query("begin");
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
