// Owner: R3 (roles.md).
// Supabase transaction-mode pooler checks (architecture §12.3, §6.6; R3-14). Request code sets
// app.user_id with set_config(..., true) so it lives only for the transaction; behind a
// transaction-mode pooler the next transaction may land on the same server connection, so the
// setting must never leak. The checkpointer must also work through the pooler without setup().
// Skipped unless DATABASE_URL_POOLER is set (the reins_server pooler URL, test only).

import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { emptyCheckpoint } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHECKPOINT_SCHEMA } from "@/src/agent/checkpointer";

const POOLER_URL = process.env.DATABASE_URL_POOLER;

describe.skipIf(!POOLER_URL)("foundations: Supabase pooler (transaction mode)", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: POOLER_URL, max: 5 });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("app.user_id set in a transaction never leaks to another transaction", async () => {
    const ids = Array.from({ length: 20 }, () => randomUUID());
    const seen = await Promise.all(
      ids.map(async (id) => {
        const c = await pool.connect();
        try {
          await c.query("begin");
          await c.query("select set_config('app.user_id', $1, true)", [id]);
          // Give other transactions time to interleave on the pooled connections.
          await c.query("select pg_sleep(0.01)");
          const r = await c.query<{ v: string }>("select current_setting('app.user_id', true) as v");
          await c.query("commit");
          return r.rows[0].v;
        } catch (e) {
          await c.query("rollback").catch(() => {});
          throw e;
        } finally {
          c.release();
        }
      }),
    );
    expect(seen).toEqual(ids);

    // Outside any transaction the setting is empty (or never defined) on every connection.
    const after = await Promise.all(
      Array.from({ length: 10 }, () => pool.query<{ v: string | null }>("select current_setting('app.user_id', true) as v")),
    );
    for (const r of after) expect([null, ""]).toContain(r.rows[0].v);
  });

  it("the checkpointer round-trips a checkpoint without setup()", async () => {
    const saver = PostgresSaver.fromConnString(POOLER_URL!, { schema: CHECKPOINT_SCHEMA });
    const threadId = `pooler-test-${randomUUID()}`;
    try {
      const checkpoint = emptyCheckpoint();
      checkpoint.channel_values = { probe: "pooler" };
      const config = { configurable: { thread_id: threadId, checkpoint_ns: "" } };
      const saved = await saver.put(config, checkpoint, { source: "input", step: -1, parents: {} }, {});
      expect(saved.configurable?.checkpoint_id).toBe(checkpoint.id);

      const tuple = await saver.getTuple({ configurable: { thread_id: threadId, checkpoint_ns: "" } });
      expect(tuple?.checkpoint.id).toBe(checkpoint.id);
      expect(tuple?.metadata?.source).toBe("input");
    } finally {
      await saver.deleteThread(threadId).catch(() => {});
      await saver.end();
    }
  });
});
