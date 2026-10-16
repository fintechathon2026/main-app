// Test fixtures for the foundations integration tests. Each test file creates fresh users
// through an admin connection (tests only), so tests never depend on or mutate the demo seed.

import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { LIN_MANDATE_V3 } from "@/src/core/mandate/examples";
import { actionHash, canonical, hashPolicy } from "@/src/core/mandate/canonical";
import { handleMockbankRequest } from "@/src/mockbank/http";
import type { MockbankTransport } from "@/src/server/executor";
import type { PgPlanStore } from "@/src/server/plan-store";

export const DB_ENABLED = !!process.env.DATABASE_URL;

export function adminPool(): Pool {
  return new Pool({
    connectionString: process.env.TEST_ADMIN_DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:54322/postgres",
    max: 2,
  });
}

/** Calls the mock bank route logic in-process (same code as app/mockbank/[...path]/route.ts). */
export const inProcessTransport: MockbankTransport = async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/mockbank\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  return handleMockbankRequest(req, path);
};

export type TestUser = { id: string; bills: Record<string, string> };

/** A Lin-like user: mandate v3, three billers, 6 months of paid bills and current unpaid bills. */
export async function createTestUser(admin: Pool, current: { biller: string; amount: number; key: string }[]): Promise<TestUser> {
  const id = randomUUID();
  const c = await admin.connect();
  try {
    await c.query("begin");
    await c.query(
      `insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
       values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, now(), now())`,
      [id, `test-${id}@test.reins.local`],
    );
    await c.query("insert into public.users (id, email, timezone, base_currency) values ($1, $2, 'Asia/Shanghai', 'CNY')", [id, `test-${id}@test.reins.local`]);
    await c.query("insert into public.kill_switch (user_id, enabled) values ($1, false)", [id]);
    const policy = JSON.parse(canonical(LIN_MANDATE_V3));
    await c.query(
      `insert into public.mandates (user_id, version, policy_json, policy_hash, signed_at, status, created_via)
       values ($1, 3, $2, $3, now(), 'active', 'template')`,
      [id, JSON.stringify(policy), hashPolicy(policy)],
    );
    for (const b of ["SZ_POWER", "CHINA_MOBILE", "LANDLORD_WANG"]) {
      await c.query(
        `insert into public.billers (id, user_id, name, payee_account_ref, verified_at, verified_via)
         values ($1, $2, $1, 'registry:' || $1, now(), 'mock_bank')`,
        [b, id],
      );
    }
    await c.query(
      `insert into mockbank.accounts (customer_id, name, type, currency, balance, is_default)
       values ($1, 'Test checking', 'checking', 'CNY', 100000, true)`,
      [id],
    );
    const history: [string, number[]][] = [
      ["SZ_POWER", [196, 214, 238, 251, 205, 222]],
      ["CHINA_MOBILE", [98, 98, 98, 98, 98, 98]],
      ["LANDLORD_WANG", [4500, 4500, 4500, 4500, 4500, 4500]],
    ];
    for (const [biller, amounts] of history) {
      for (const [i, amount] of amounts.entries()) {
        await insertBill(c, id, biller, amount, `current_date - ${(i + 1) * 30}`, "paid");
      }
    }
    const bills: Record<string, string> = {};
    for (const b of current) bills[b.key] = await insertBill(c, id, b.biller, b.amount, "current_date + 3", "unpaid");
    await c.query("commit");
    return { id, bills };
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}

async function insertBill(c: import("pg").PoolClient, userId: string, biller: string, amount: number, dueExpr: string, status: "paid" | "unpaid") {
  const billId = randomUUID();
  await c.query(
    `insert into public.bills (id, user_id, biller_id, amount, currency, amount_origin, due_date, period, status)
     values ($1, $2, $3, $4, 'CNY', 'mock_bank', ${dueExpr}, to_char(${dueExpr}, 'YYYY-MM'), $5)`,
    [billId, userId, biller, amount, status],
  );
  await c.query(
    `insert into mockbank.bills (id, customer_id, biller_id, amount, currency, due_date, period, status)
     values ($1, $2, $3, $4, 'CNY', ${dueExpr}, to_char(${dueExpr}, 'YYYY-MM'), $5)`,
    [billId, userId, biller, amount, status],
  );
  return billId;
}

/** Persist pay_bill actions for a new plan, exactly as the agent's persist_plan node would. */
export async function planPayments(store: PgPlanStore, userId: string, payments: { billId: string; billerId: string; amount: number }[]) {
  const planId = await store.createPlan({ userId, trigger: "chat", subjectId: randomUUID() });
  const ids = await store.persistActions({
    planId,
    userId,
    mandateVersion: 3,
    actions: payments.map((p, idx) => {
      const args = { bill_id: p.billId, biller_id: p.billerId, amount: p.amount };
      return { idx, tool: "pay_bill", args, argsHash: actionHash("pay_bill", args), idempotencyKey: `test:${randomUUID()}` };
    }),
  });
  return { planId, ids };
}
