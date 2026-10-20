// Owner: R3 (roles.md).
// Row Level Security and grants per database role (architecture §12.1, §12.3; R3-14). Two fresh
// users A and B; every check asks "can this role see or change A's data from outside?".
//   authenticated  Supabase JWT user (B): owner reads only, no writes, no private schemas
//   anon           no access to user tables at all
//   reins_server   app.user_id scopes reads and writes; audit is append-only; no mockbank
//   reins_mockbank mockbank schema only
// Skipped when DATABASE_URL is not set. Run with the env loaded (see AGENTS.md).

import { randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPool, setPool } from "@/src/server/db/pool";
import { getMockbankPool, setMockbankPool } from "@/src/mockbank/db";
import { appendAudit } from "@/src/server/audit";
import { DB_ENABLED, adminPool, createTestUser, type TestUser } from "./helpers";

// Same lists as supabase/migrations/20261017000005_rls.sql.
const USER_TABLES = [
  "data_sources", "accounts", "transactions", "documents", "billers", "bills", "subscriptions",
  "usage_signals", "recommendations", "mandates", "plans", "actions", "approvals", "daily_limits",
  "cap_reservations", "audit_log", "kill_switch", "wallets", "prepaid_plans", "prepaid_sessions", "chain_txs",
];
const REFERENCE_TABLES = ["merchants", "fx_rates", "prepaid_merchants", "prepaid_offers", "attestations", "risk_signals"];
const SYSTEM_TABLES = ["job_runs", "chain_cursors"];
const ALL_PUBLIC = [...USER_TABLES, ...REFERENCE_TABLES, ...SYSTEM_TABLES, "users"];
// Rows createTestUser() and beforeAll() seed for A.
const SEEDED_FOR_A = ["billers", "bills", "mandates", "kill_switch", "audit_log", "wallets", "prepaid_plans"];
const PRIVATE_TABLES = [
  "mockbank.accounts", "mockbank.payments", "mockbank.transfers", "mockbank.call_log",
  "mockbank.escrow_plans", "mockbank.escrow_payouts", "mockbank.escrow_auth_used",
  "langgraph.checkpoints", "langgraph.checkpoint_writes", "eval.eval_cases", "eval.eval_runs",
];
const SYSTEM_FUNCTIONS = ["public.cron_user_ids()", "public.risk_active_prepaid_plans()"];

const randomAddress = () => "0x" + randomBytes(20).toString("hex");

/** Expect `sql` to fail with `re`, without aborting the surrounding transaction. */
async function rejects(c: PoolClient, sql: string, params: unknown[] = [], re: RegExp = /permission denied/) {
  await c.query("savepoint probe");
  await expect(c.query(sql, params), sql).rejects.toThrow(re);
  await c.query("rollback to savepoint probe");
}

async function countFor(c: PoolClient, table: string, userId: string): Promise<number> {
  const col = table === "users" ? "id" : "user_id";
  const r = await c.query(`select count(*)::int as n from public.${table} where ${col} = $1`, [userId]);
  return r.rows[0].n;
}

describe.skipIf(!DB_ENABLED)("foundations: RLS and grants per role", () => {
  let admin: Pool;
  let a: TestUser;
  let b: TestUser;
  let planIdA: string;
  const firstColumn = new Map<string, string>();

  /** Run `fn` on an admin connection switched to `role`, optionally as a JWT user; always rolls back. */
  async function asRole(role: "authenticated" | "anon", sub: string | null, fn: (c: PoolClient) => Promise<void>) {
    const c = await admin.connect();
    try {
      await c.query("begin");
      await c.query(`set local role ${role}`);
      if (sub) {
        await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub, role })]);
      }
      await fn(c);
    } finally {
      await c.query("rollback").catch(() => {});
      c.release();
    }
  }

  beforeAll(async () => {
    admin = adminPool();
    const member = await admin.query("select pg_has_role(current_user, 'authenticated', 'member') as ok");
    expect(member.rows[0].ok, "admin role must be able to set role authenticated").toBe(true);

    a = await createTestUser(admin, [{ biller: "SZ_POWER", amount: 200, key: "power" }]);
    b = await createTestUser(admin, []);

    const c = await admin.connect();
    try {
      await c.query("begin");
      await c.query("insert into public.wallets (user_id, address, kind) values ($1, $2, 'consumer_browser')", [a.id, randomAddress()]);
      const chainPlanId = BigInt("0x" + randomBytes(16).toString("hex")).toString();
      const p = await c.query<{ id: string }>(
        `insert into public.prepaid_plans (user_id, chain_plan_id, merchant_id, unit_price, units_total, cancel_fee_bps,
           status, purchase_tx, last_synced_block)
         values ($1, $2, 'FITBOX_FUTIAN', 10000, 10, 1000, 'active', 'mock:test', 0) returning id::text`,
        [a.id, chainPlanId],
      );
      planIdA = p.rows[0].id;
      await appendAudit(c, a.id, { actor: "system", eventType: "test.rls_seed", data: { note: "rls-roles" } });
      await c.query("commit");
    } catch (e) {
      await c.query("rollback");
      throw e;
    } finally {
      c.release();
    }

    const cols = await admin.query<{ table_name: string; column_name: string }>(
      `select distinct on (table_name) table_name, column_name from information_schema.columns
        where table_schema = 'public' and table_name = any($1::text[])
          and is_identity = 'NO' and is_generated = 'NEVER'
        order by table_name, ordinal_position`,
      [ALL_PUBLIC],
    );
    for (const r of cols.rows) firstColumn.set(r.table_name, r.column_name);
    expect(firstColumn.size).toBe(ALL_PUBLIC.length);
  });

  afterAll(async () => {
    await admin?.end();
    if (process.env.DATABASE_URL) await getPool().end();
    setPool(null);
    if (process.env.MOCKBANK_DATABASE_URL) await getMockbankPool().end();
    setMockbankPool(null);
  });

  describe("authenticated (Supabase JWT)", () => {
    it("user B reads 0 rows of user A in every user-scoped table", async () => {
      await asRole("authenticated", b.id, async (c) => {
        for (const t of [...USER_TABLES, "users"]) expect(await countFor(c, t, a.id), t).toBe(0);
      });
    });

    it("the JWT user wins over a forged app.user_id", async () => {
      await asRole("authenticated", b.id, async (c) => {
        await c.query("select set_config('app.user_id', $1, true)", [a.id]);
        for (const t of [...USER_TABLES, "users"]) expect(await countFor(c, t, a.id), t).toBe(0);
      });
    });

    it("user A reads their own seeded rows", async () => {
      await asRole("authenticated", a.id, async (c) => {
        for (const t of [...SEEDED_FOR_A, "users"]) expect(await countFor(c, t, a.id), t).toBeGreaterThan(0);
      });
    });

    it("reference tables are readable", async () => {
      await asRole("authenticated", b.id, async (c) => {
        for (const t of REFERENCE_TABLES) {
          const r = await c.query(`select count(*)::int as n from public.${t}`);
          expect(r.rows[0].n, t).toBeGreaterThanOrEqual(0);
        }
        const m = await c.query("select count(*)::int as n from public.prepaid_merchants where id = 'FITBOX_FUTIAN'");
        expect(m.rows[0].n).toBe(1);
      });
    });

    it("cannot insert, update or delete any public table", async () => {
      await asRole("authenticated", a.id, async (c) => {
        for (const t of ALL_PUBLIC) {
          const col = firstColumn.get(t)!;
          await rejects(c, `insert into public.${t} default values`);
          await rejects(c, `update public.${t} set ${col} = ${col}`);
          await rejects(c, `delete from public.${t}`);
        }
      });
    });

    it("cannot read system tables, private schemas or call system functions", async () => {
      await asRole("authenticated", a.id, async (c) => {
        for (const t of SYSTEM_TABLES) await rejects(c, `select count(*) from public.${t}`);
        for (const t of PRIVATE_TABLES) await rejects(c, `select count(*) from ${t}`);
        for (const f of SYSTEM_FUNCTIONS) await rejects(c, `select * from ${f}`);
      });
    });
  });

  describe("anon", () => {
    it("cannot read any public table, private schema or system function", async () => {
      await asRole("anon", null, async (c) => {
        for (const t of ALL_PUBLIC) await rejects(c, `select count(*) from public.${t}`);
        for (const t of PRIVATE_TABLES) await rejects(c, `select count(*) from ${t}`);
        for (const f of SYSTEM_FUNCTIONS) await rejects(c, `select * from ${f}`);
      });
    });
  });

  describe("reins_server (DATABASE_URL)", () => {
    async function onServer(fn: (c: PoolClient) => Promise<void>) {
      const c = await getPool().connect();
      try {
        await c.query("begin");
        await fn(c);
      } finally {
        await c.query("rollback").catch(() => {});
        c.release();
      }
    }

    it("connects as reins_server without BYPASSRLS", async () => {
      await onServer(async (c) => {
        const r = await c.query("select current_user as u, rolbypassrls as bypass from pg_roles where rolname = current_user");
        expect(r.rows[0]).toEqual({ u: "reins_server", bypass: false });
      });
    });

    it("with app.user_id = B reads 0 rows of A in every user-scoped table", async () => {
      await onServer(async (c) => {
        await c.query("select set_config('app.user_id', $1, true)", [b.id]);
        for (const t of [...USER_TABLES, "users"]) expect(await countFor(c, t, a.id), t).toBe(0);
      });
    });

    it("without app.user_id reads nothing from user-scoped tables", async () => {
      await onServer(async (c) => {
        for (const t of [...USER_TABLES, "users"]) {
          const r = await c.query(`select count(*)::int as n from public.${t}`);
          expect(r.rows[0].n, t).toBe(0);
        }
      });
    });

    it("with app.user_id = A sees A's rows (sanity)", async () => {
      await onServer(async (c) => {
        await c.query("select set_config('app.user_id', $1, true)", [a.id]);
        for (const t of SEEDED_FOR_A) expect(await countFor(c, t, a.id), t).toBeGreaterThan(0);
      });
    });

    it("cannot write rows for another user", async () => {
      await onServer(async (c) => {
        await c.query("select set_config('app.user_id', $1, true)", [b.id]);
        const rls = /row-level security/;
        await rejects(c, "insert into public.kill_switch (user_id, enabled) values ($1, true)", [a.id], rls);
        await rejects(
          c,
          `insert into public.actions (plan_id, user_id, idx, tool, args_json, args_hash, mandate_version, idempotency_key)
           values (gen_random_uuid(), $1, 0, 'pay_bill', '{}', $2, 3, $3)`,
          [a.id, "0".repeat(64), `rls:${a.id}`],
          rls,
        );
        await rejects(c, "insert into public.wallets (user_id, address, kind) values ($1, $2, 'consumer_browser')", [a.id, randomAddress()], rls);
        // Updates and deletes of A's rows match nothing under B.
        const u = await c.query("update public.kill_switch set enabled = true where user_id = $1", [a.id]);
        expect(u.rowCount).toBe(0);
        const d = await c.query("delete from public.prepaid_plans where user_id = $1", [a.id]);
        expect(d.rowCount).toBe(0);
      });
    });

    it("cannot update or delete the audit log, even for its own user", async () => {
      await onServer(async (c) => {
        await c.query("select set_config('app.user_id', $1, true)", [a.id]);
        await rejects(c, "update public.audit_log set actor = actor where user_id = $1", [a.id]);
        await rejects(c, "delete from public.audit_log where user_id = $1", [a.id]);
      });
    });

    it("cannot read the mockbank schema", async () => {
      await onServer(async (c) => {
        for (const t of PRIVATE_TABLES.filter((x) => x.startsWith("mockbank."))) await rejects(c, `select count(*) from ${t}`);
      });
    });

    it("system functions list ids across users", async () => {
      await onServer(async (c) => {
        const plans = await c.query<{ user_id: string; plan_id: string; merchant_id: string }>(
          "select user_id::text, plan_id::text, merchant_id from public.risk_active_prepaid_plans()",
        );
        expect(plans.rows).toContainEqual({ user_id: a.id, plan_id: planIdA, merchant_id: "FITBOX_FUTIAN" });
        const users = await c.query<{ id: string }>("select id::text from public.cron_user_ids() as id");
        const ids = users.rows.map((r) => r.id);
        expect(ids).toContain(a.id);
        expect(ids).toContain(b.id);
      });
    });
  });

  describe("catalog", () => {
    // Tables in schema public allowed to run without RLS. Empty on purpose: reference tables
    // (merchants, fx_rates, prepaid_merchants, prepaid_offers, attestations, risk_signals) and
    // system tables (job_runs, chain_cursors) are under RLS by 20261017000005_rls.sql, so no
    // exception is justified. Any future entry needs a migration reference and a reason.
    const TABLES_WITHOUT_RLS: readonly string[] = [];

    async function publicTables() {
      const r = await admin.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
        `select c.relname, c.relrowsecurity, c.relforcerowsecurity
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind in ('r','p')
          order by 1`,
      );
      return r.rows;
    }

    it("every table in schema public has row level security enabled and forced", async () => {
      const rows = await publicTables();
      expect(rows.length).toBeGreaterThan(0);
      const offenders = rows
        .filter((r) => !TABLES_WITHOUT_RLS.includes(r.relname))
        .filter((r) => !r.relrowsecurity || !r.relforcerowsecurity)
        .map((r) => r.relname);
      expect(offenders).toEqual([]);
    });

    it("the no-RLS allowlist names only existing tables", async () => {
      const names = new Set((await publicTables()).map((r) => r.relname));
      for (const t of TABLES_WITHOUT_RLS) expect(names.has(t), t).toBe(true);
    });
  });

  describe("reins_mockbank (MOCKBANK_DATABASE_URL)", () => {
    it("reads the mockbank schema but not public tables", async () => {
      const c = await getMockbankPool().connect();
      try {
        await c.query("begin");
        const r = await c.query("select count(*)::int as n from mockbank.accounts where customer_id = $1", [a.id]);
        expect(r.rows[0].n).toBe(1);
        for (const t of ["mockbank.transfers", "mockbank.escrow_payouts", "mockbank.escrow_auth_used"]) {
          await c.query(`select count(*) from ${t}`);
        }
        await rejects(c, "select count(*) from public.users");
        await rejects(c, "select count(*) from public.bills");
        for (const f of SYSTEM_FUNCTIONS) await rejects(c, `select * from ${f}`);
      } finally {
        await c.query("rollback").catch(() => {});
        c.release();
      }
    });
  });
});
