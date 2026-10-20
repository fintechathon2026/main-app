// Owner: R3 (roles.md).
// Mock bank internal transfers (savings sweep, PRD §14.1, FR11), the 24h reverse (FR11.2),
// the payday scenario and the call-log export (FR10.4). Skipped when DATABASE_URL is not set.

import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getMockbankPool, setMockbankPool } from "@/src/mockbank/db";
import { CALL_LOG_COLUMNS } from "@/src/mockbank/bank";
import { DB_ENABLED, adminPool, createTestUser, inProcessTransport } from "./helpers";

type CallOpts = { customer?: string; key?: string; body?: unknown; apiKey?: string };

async function call(method: "GET" | "POST", path: string, o: CallOpts = {}) {
  const headers: Record<string, string> = { "x-api-key": o.apiKey ?? process.env.MOCKBANK_API_KEY!, "content-type": "application/json" };
  if (o.customer) headers["x-customer-id"] = o.customer;
  if (o.key) headers["idempotency-key"] = o.key;
  const res = await inProcessTransport(
    new Request(`http://local/mockbank${path}`, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) }),
  );
  return res;
}

async function callJson(method: "GET" | "POST", path: string, o: CallOpts = {}) {
  const res = await call(method, path, o);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe.skipIf(!DB_ENABLED)("mock bank: internal transfers, reverse and call-log export", () => {
  let admin: Pool;

  beforeAll(() => {
    process.env.MOCKBANK_API_KEY ??= "test-mockbank-key";
    admin = adminPool();
  });

  afterAll(async () => {
    await admin.end();
    await getMockbankPool().end();
    setMockbankPool(null);
  });

  /** A test user (checking 100000, default) plus a savings account at the bank. */
  async function userWithSavings(savingsBalance = 0) {
    const u = await createTestUser(admin, []);
    const s = await admin.query(
      `insert into mockbank.accounts (customer_id, name, type, currency, balance, is_default)
       values ($1, 'Test savings', 'savings', 'CNY', $2, false) returning id`,
      [u.id, savingsBalance],
    );
    const c = await admin.query("select id from mockbank.accounts where customer_id = $1 and is_default", [u.id]);
    return { id: u.id, checking: c.rows[0].id as string, savings: s.rows[0].id as string };
  }

  const balance = async (accountId: string) =>
    Number((await admin.query("select balance from mockbank.accounts where id = $1", [accountId])).rows[0].balance);

  const sweep = (customer: string, amount: unknown, key = `sweep:${randomUUID()}`, extra: Record<string, unknown> = {}) =>
    callJson("POST", "/transfers/internal", { customer, key, body: { amount, ...extra } });

  const reverse = (customer: string, transferId: string, key = `reverse:${randomUUID()}`) =>
    callJson("POST", `/transfers/${transferId}/reverse`, { customer, key, body: {} });

  it("sweeps checking to savings once and replays the same transfer for the same key", async () => {
    const u = await userWithSavings();
    const key = `sweep:${randomUUID()}`;
    const r1 = await sweep(u.id, 3000, key);
    expect(r1.status).toBe(201);
    expect(r1.json).toMatchObject({ status: "succeeded", amount: 3000, currency: "CNY" });
    expect(String(r1.json.to_account)).toMatch(/^\*\*\*\*/);
    const until = new Date(String(r1.json.reversible_until)).getTime();
    expect(until - Date.now()).toBeGreaterThan(23 * 3600_000);
    expect(until - Date.now()).toBeLessThanOrEqual(24 * 3600_000 + 60_000);

    const r2 = await sweep(u.id, 3000, key);
    expect(r2.status).toBe(201);
    expect(r2.json.transfer_id).toBe(r1.json.transfer_id);
    expect(r2.json.replayed).toBe(true);

    expect(await balance(u.checking)).toBe(97000);
    expect(await balance(u.savings)).toBe(3000);
    const rows = await admin.query("select status, from_account_id, to_account_id from mockbank.transfers where customer_id = $1", [u.id]);
    expect(rows.rows).toEqual([{ status: "succeeded", from_account_id: u.checking, to_account_id: u.savings }]);
    const tx = await admin.query(
      `select t.descriptor, t.amount::int as amount from mockbank.transactions t join mockbank.accounts a on a.id = t.account_id
        where a.customer_id = $1 order by t.amount`,
      [u.id],
    );
    expect(tx.rows).toEqual([
      { descriptor: "SWEEP TO SAVINGS", amount: -3000 },
      { descriptor: "SWEEP FROM CHECKING", amount: 3000 },
    ]);
    const ev = await admin.query("select count(*)::int as n from mockbank.events where customer_id = $1 and type = 'transfer.succeeded'", [u.id]);
    expect(ev.rows[0].n).toBe(1);
  });

  it("rejects amounts above the balance (422) and non-positive amounts or amounts with more than two decimals (400)", async () => {
    const u = await userWithSavings();
    expect((await sweep(u.id, 100001)).json.error).toBe("insufficient_funds");
    expect((await sweep(u.id, 100001)).status).toBe(422);
    for (const bad of [-5, 0, 12.505, "100", null]) {
      const r = await sweep(u.id, bad);
      expect(r.status).toBe(400);
      expect(r.json.error).toBe("invalid_request");
    }
    expect(await balance(u.checking)).toBe(100000);
    expect((await admin.query("select count(*)::int as n from mockbank.transfers where customer_id = $1", [u.id])).rows[0].n).toBe(0);
  });

  it("accepts a sweep of 12.50 and books exactly 12.50 on both accounts", async () => {
    const u = await userWithSavings();
    const r = await sweep(u.id, 12.50);
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ status: "succeeded", amount: 12.5 });
    const tx = await admin.query(
      "select account_id, amount::text as amount from mockbank.transactions where account_id = any($1::uuid[])",
      [[u.checking, u.savings]],
    );
    const byAccount = Object.fromEntries(tx.rows.map((row) => [row.account_id, row.amount]));
    expect(byAccount).toEqual({ [u.checking]: "-12.50", [u.savings]: "12.50" });
    const t = await admin.query("select amount::text as amount from mockbank.transfers where id = $1", [r.json.transfer_id]);
    expect(t.rows[0].amount).toBe("12.50");

    const back = await reverse(u.id, String(r.json.transfer_id));
    expect(back.status).toBe(200);
    expect(back.json.amount).toBe(12.5);
    expect(await balance(u.checking)).toBe(100000);
    expect(await balance(u.savings)).toBe(0);
  });

  it("rejects 12.505, 0 and \"abc\" with 400 and moves nothing", async () => {
    const u = await userWithSavings();
    for (const bad of [12.505, 0, "abc"]) {
      const r = await sweep(u.id, bad);
      expect(r.status).toBe(400);
      expect(r.json.error).toBe("invalid_request");
    }
    expect(await balance(u.checking)).toBe(100000);
    expect(await balance(u.savings)).toBe(0);
    expect((await admin.query("select count(*)::int as n from mockbank.transfers where customer_id = $1", [u.id])).rows[0].n).toBe(0);
  });

  it("cannot be routed elsewhere: destination keys in the body are ignored", async () => {
    const u = await userWithSavings();
    const other = await userWithSavings();
    const r = await sweep(u.id, 500, undefined, {
      to_account: other.savings,
      to_account_id: other.savings,
      to: other.savings,
      account_id: other.savings,
      destination: other.savings,
    });
    expect(r.status).toBe(201);
    const row = await admin.query("select to_account_id from mockbank.transfers where id = $1", [r.json.transfer_id]);
    expect(row.rows[0].to_account_id).toBe(u.savings);
    expect(await balance(u.savings)).toBe(500);
    expect(await balance(other.savings)).toBe(0);
  });

  it("returns 422 no_savings_account when the customer has no savings account", async () => {
    const u = await createTestUser(admin, []);
    const r = await sweep(u.id, 100);
    expect(r.status).toBe(422);
    expect(r.json.error).toBe("no_savings_account");
  });

  it("reverses within the window once, restoring both balances", async () => {
    const u = await userWithSavings();
    const t = await sweep(u.id, 2500);
    const id = String(t.json.transfer_id);
    const r = await reverse(u.id, id);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ transfer_id: id, status: "reversed", amount: 2500, currency: "CNY" });
    expect(await balance(u.checking)).toBe(100000);
    expect(await balance(u.savings)).toBe(0);
    const row = await admin.query("select status, reversed_at from mockbank.transfers where id = $1", [id]);
    expect(row.rows[0].status).toBe("reversed");
    expect(row.rows[0].reversed_at).not.toBeNull();

    const again = await reverse(u.id, id);
    expect(again.status).toBe(409);
    expect(again.json.error).toBe("transfer_already_reversed");
    expect(await balance(u.checking)).toBe(100000);
  });

  it("refuses to reverse after the 24h window", async () => {
    const u = await userWithSavings();
    const t = await sweep(u.id, 700);
    await admin.query("update mockbank.transfers set reversible_until = now() - interval '1 minute' where id = $1", [t.json.transfer_id]);
    const r = await reverse(u.id, String(t.json.transfer_id));
    expect(r.status).toBe(422);
    expect(r.json.error).toBe("reverse_window_expired");
    expect(await balance(u.savings)).toBe(700);
  });

  it("refuses to reverse when savings no longer hold the amount", async () => {
    const u = await userWithSavings();
    const t = await sweep(u.id, 900);
    await admin.query("update mockbank.accounts set balance = 100 where id = $1", [u.savings]);
    const r = await reverse(u.id, String(t.json.transfer_id));
    expect(r.status).toBe(422);
    expect(r.json.error).toBe("insufficient_funds");
  });

  it("hides another customer's transfer (404) and rejects malformed ids", async () => {
    const owner = await userWithSavings();
    const intruder = await userWithSavings();
    const t = await sweep(owner.id, 400);
    const r = await reverse(intruder.id, String(t.json.transfer_id));
    expect(r.status).toBe(404);
    expect(r.json.error).toBe("transfer_not_found");
    expect((await reverse(owner.id, "not-a-uuid")).status).toBe(404);
    expect((await reverse(owner.id, randomUUID())).status).toBe(404);
    expect(await balance(owner.savings)).toBe(400);
  });

  it("payday posts an income transaction and credits the default account", async () => {
    const u = await userWithSavings();
    const list = await callJson("GET", "/test/scenarios");
    expect(list.status).toBe(200);
    const names = (list.json.scenarios as { name: string; description: string }[]).map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(["new_bill", "anomalous_electricity", "trial_converting", "low_balance", "payday"]));

    const r = await callJson("POST", "/test/scenarios/payday", { customer: u.id, body: {} });
    expect(r.status).toBe(201);
    expect(r.json.result).toMatchObject({ amount: 15000, descriptor: "SALARY SHENZHEN TECH" });
    expect(await balance(u.checking)).toBe(115000);
    const custom = await callJson("POST", "/test/scenarios/payday", { customer: u.id, body: { amount: 8000, descriptor: "SALARY TEST" } });
    expect(custom.json.result).toMatchObject({ amount: 8000, descriptor: "SALARY TEST" });
    expect((await callJson("POST", "/test/scenarios/payday", { customer: u.id, body: { amount: -1 } })).status).toBe(400);
  });

  it("exports the call log per customer as jsonl and csv, without logging the export", async () => {
    const u = await userWithSavings();
    await call("GET", "/accounts", { customer: u.id });
    await call("GET", "/bills", { customer: u.id });
    await sweep(u.id, 100);
    await call("GET", "/billers");

    const exportCount = async () =>
      (await admin.query("select count(*)::int as n from mockbank.call_log where path = '/call-log'")).rows[0].n as number;
    const before = await exportCount();

    const jsonl = await call("GET", `/call-log?format=jsonl&customer=${u.id}`);
    expect(jsonl.status).toBe(200);
    expect(jsonl.headers.get("content-type")).toMatch(/^application\/x-ndjson/);
    expect(jsonl.headers.get("content-disposition")).toBe('attachment; filename="mockbank-call-log.jsonl"');
    const lines = (await jsonl.text()).trimEnd().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines.map((l) => l.path)).toEqual(["/accounts", "/bills", "/transfers/internal"]);
    for (const l of lines) {
      expect(l.customer_id).toBe(u.id);
      expect(Object.keys(l).sort()).toEqual([...CALL_LOG_COLUMNS].sort());
    }
    const ids = lines.map((l) => Number(l.id));
    expect(ids).toEqual([...ids].sort((a, b) => a - b));

    const since = await call("GET", `/call-log?format=jsonl&customer=${u.id}&since=${ids[0]}&limit=1`);
    const sinceLines = (await since.text()).trimEnd().split("\n");
    expect(sinceLines).toHaveLength(1);
    expect(JSON.parse(sinceLines[0]).path).toBe("/bills");

    const csv = await call("GET", `/call-log?format=csv&customer=${u.id}`);
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-type")).toMatch(/^text\/csv/);
    expect(csv.headers.get("content-disposition")).toBe('attachment; filename="mockbank-call-log.csv"');
    const csvText = await csv.text();
    expect(csvText.split("\r\n")[0]).toBe(CALL_LOG_COLUMNS.join(","));
    expect(csvText).toContain("/transfers/internal");

    const bad = await call("GET", `/call-log?format=xml&customer=${u.id}`);
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe("invalid_format");
    expect((await call("GET", "/call-log?format=jsonl&customer=nope")).status).toBe(400);
    expect((await call("GET", "/call-log?format=jsonl", { apiKey: "wrong-key" })).status).toBe(401);

    expect(await exportCount()).toBe(before);
  });
});
