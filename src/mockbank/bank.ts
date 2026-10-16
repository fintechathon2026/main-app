// Owner: R3 (roles.md). Minimal version by R1; extend, don't duplicate.
// Mock bank domain logic (PRD §14.1). Plays the external bank: it resolves the payee's account
// from its own biller registry (no destination is ever accepted from the caller, FR4.5) and
// stores idempotency keys so a repeated call returns the original result (PRD §10.7).

import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { getMockbankPool, mbTx } from "./db";

export class MockbankError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export type MbResponse = { status: number; body: unknown };

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/**
 * Run `fn` once per idempotency key. The first result (success or definitive 4xx failure) is
 * stored and replayed for every later call with the same key. An advisory lock serializes
 * concurrent calls with the same key.
 */
async function idempotent(key: string, kind: string, fn: (tx: PoolClient) => Promise<MbResponse>): Promise<MbResponse> {
  if (!key) throw new MockbankError(400, "idempotency_key_required");
  return mbTx(async (tx) => {
    await tx.query("select pg_advisory_xact_lock(hashtext('mb:idem:' || $1))", [key]);
    const prior = await tx.query("select kind, status_code, response_json from mockbank.operations where idempotency_key = $1", [key]);
    if (prior.rowCount) {
      if (prior.rows[0].kind !== kind) throw new MockbankError(422, "idempotency_key_reused");
      return { status: prior.rows[0].status_code, body: { ...prior.rows[0].response_json, replayed: true } };
    }
    let res: MbResponse;
    await tx.query("savepoint op");
    try {
      res = await fn(tx);
    } catch (e) {
      if (!(e instanceof MockbankError) || e.status >= 500) throw e;
      await tx.query("rollback to savepoint op");
      res = { status: e.status, body: { error: e.code, message: e.message } };
    }
    await tx.query(
      "insert into mockbank.operations (idempotency_key, kind, status_code, response_json) values ($1, $2, $3, $4)",
      [key, kind, res.status, JSON.stringify(res.body)],
    );
    return res;
  });
}

async function emit(tx: PoolClient, customerId: string, type: string, payload: unknown) {
  await tx.query("insert into mockbank.events (customer_id, type, payload) values ($1, $2, $3)", [customerId, type, JSON.stringify(payload)]);
}

// ---- Reads ------------------------------------------------------------------------------

export async function listAccounts(customerId: string) {
  const r = await getMockbankPool().query(
    "select id, name, type, currency, balance, is_default from mockbank.accounts where customer_id = $1 order by is_default desc, name",
    [customerId],
  );
  return r.rows.map((a) => ({ ...a, balance: num(a.balance) }));
}

export async function listTransactions(customerId: string, accountId: string, from?: string, to?: string) {
  const r = await getMockbankPool().query(
    `select t.id, t.posted_at, t.amount, t.currency, t.descriptor, t.original_amount, t.original_currency, t.payment_id
       from mockbank.transactions t join mockbank.accounts a on a.id = t.account_id
      where a.customer_id = $1 and a.id = $2
        and ($3::timestamptz is null or t.posted_at >= $3) and ($4::timestamptz is null or t.posted_at < $4)
      order by t.posted_at`,
    [customerId, accountId, from ?? null, to ?? null],
  );
  return r.rows.map((t) => ({ ...t, amount: num(t.amount), original_amount: num(t.original_amount) }));
}

export async function listBillers() {
  // The registry is public; account refs are masked in responses.
  const r = await getMockbankPool().query("select id, name, category, account_ref from mockbank.billers order by id");
  return r.rows.map((b) => ({ id: b.id, name: b.name, category: b.category, account_ref_masked: mask(b.account_ref) }));
}

export async function listBills(customerId: string, status?: string) {
  const r = await getMockbankPool().query(
    `select id, biller_id, amount::int as amount, currency, due_date::text as due_date, period, status
       from mockbank.bills where customer_id = $1 and ($2::text is null or status = $2) order by due_date`,
    [customerId, status ?? null],
  );
  return r.rows;
}

export async function listSubscriptions(customerId: string) {
  const r = await getMockbankPool().query(
    `select id, merchant_name, amount, currency, cycle_days, next_renewal::text as next_renewal, status, trial_end, cancelled_at
       from mockbank.subscriptions where customer_id = $1 order by merchant_name`,
    [customerId],
  );
  return r.rows.map((s) => ({ ...s, amount: num(s.amount) }));
}

export async function listEvents(customerId: string, since: number, limit = 100) {
  const r = await getMockbankPool().query(
    "select seq::int as seq, type, payload, created_at from mockbank.events where customer_id = $1 and seq > $2 order by seq limit $3",
    [customerId, since, limit],
  );
  return r.rows;
}

const mask = (ref: string) => `****${ref.slice(-4)}`;

// ---- Payments ---------------------------------------------------------------------------

export type PaymentRequest = { bill_id: string; biller_id: string; amount: number; idempotency_key: string };

export function createPayment(customerId: string, req: PaymentRequest): Promise<MbResponse> {
  return idempotent(req.idempotency_key, "payment", async (tx) => {
    if (!req.bill_id || !req.biller_id || !Number.isInteger(req.amount) || req.amount <= 0) {
      throw new MockbankError(400, "invalid_request");
    }
    const bill = await tx.query(
      "select id, customer_id, biller_id, amount::int as amount, currency, status from mockbank.bills where id = $1 for update",
      [req.bill_id],
    );
    const b = bill.rows[0];
    if (!b || b.customer_id !== customerId) throw new MockbankError(404, "bill_not_found");
    if (b.biller_id !== req.biller_id) throw new MockbankError(422, "biller_mismatch");
    if (b.amount !== req.amount) throw new MockbankError(422, "amount_mismatch");
    if (b.status === "paid") throw new MockbankError(409, "bill_already_paid");

    // Destination comes from the bank's own registry, never from the request.
    const biller = await tx.query("select account_ref, name from mockbank.billers where id = $1", [b.biller_id]);
    if (!biller.rowCount) throw new MockbankError(422, "biller_not_registered");

    const acct = await tx.query(
      "select id, balance from mockbank.accounts where customer_id = $1 and is_default for update",
      [customerId],
    );
    if (!acct.rowCount) throw new MockbankError(422, "no_default_account");
    if (Number(acct.rows[0].balance) < req.amount) throw new MockbankError(422, "insufficient_funds");

    const paymentId = randomUUID();
    const postedAt = new Date().toISOString();
    const body = {
      payment_id: paymentId,
      status: "succeeded",
      bill_id: b.id,
      biller_id: b.biller_id,
      amount: req.amount,
      currency: b.currency,
      destination: mask(biller.rows[0].account_ref),
      posted_at: postedAt,
    };
    await tx.query("update mockbank.accounts set balance = balance - $2 where id = $1", [acct.rows[0].id, req.amount]);
    await tx.query(
      `insert into mockbank.transactions (account_id, posted_at, amount, currency, descriptor, payment_id)
       values ($1, $2, $3, $4, $5, $6)`,
      [acct.rows[0].id, postedAt, -req.amount, b.currency, `BILLPAY ${biller.rows[0].name}`, paymentId],
    );
    await tx.query(
      `insert into mockbank.payments (id, idempotency_key, customer_id, bill_id, biller_id, amount, account_id,
         destination_account_ref, status, response_json)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 'succeeded', $9)`,
      [paymentId, req.idempotency_key, customerId, b.id, b.biller_id, req.amount, acct.rows[0].id, biller.rows[0].account_ref, JSON.stringify(body)],
    );
    await tx.query("update mockbank.bills set status = 'paid' where id = $1", [b.id]);
    await emit(tx, customerId, "payment.succeeded", body);
    return { status: 201, body };
  });
}

/** Reconciliation: the stored result for an idempotency key, if any. */
export async function lookupOperation(key: string): Promise<MbResponse | null> {
  const r = await getMockbankPool().query("select status_code, response_json from mockbank.operations where idempotency_key = $1", [key]);
  return r.rowCount ? { status: r.rows[0].status_code, body: r.rows[0].response_json } : null;
}

// ---- Subscriptions ----------------------------------------------------------------------

export function cancelSubscription(customerId: string, subscriptionId: string, idempotencyKey: string): Promise<MbResponse> {
  return idempotent(idempotencyKey, "subscription_cancel", async (tx) => {
    const r = await tx.query("select id, customer_id, status, merchant_name from mockbank.subscriptions where id = $1 for update", [subscriptionId]);
    const s = r.rows[0];
    if (!s || s.customer_id !== customerId) throw new MockbankError(404, "subscription_not_found");
    if (s.status === "cancelled") throw new MockbankError(409, "subscription_already_cancelled");
    const at = new Date().toISOString();
    await tx.query("update mockbank.subscriptions set status = 'cancelled', cancelled_at = $2 where id = $1", [s.id, at]);
    const body = { subscription_id: s.id, status: "cancelled", merchant: s.merchant_name, cancelled_at: at, confirmation: `mock:${randomUUID()}` };
    await emit(tx, customerId, "subscription.cancelled", body);
    return { status: 200, body };
  });
}

// ---- Mock escrow (architecture §24.13) --------------------------------------------------

export async function getEscrowPlan(chainPlanId: string) {
  const r = await getMockbankPool().query(
    `select chain_plan_id::text as chain_plan_id, owner, merchant, agent, unit_price::int as unit_price, units_total,
            units_redeemed, cancel_fee_bps, status, balance::bigint::text as balance
       from mockbank.escrow_plans where chain_plan_id = $1`,
    [chainPlanId],
  );
  if (!r.rowCount) throw new MockbankError(404, "plan_not_found");
  return r.rows[0];
}

/**
 * Mirrors PrepaidEscrow.exitWithAttestation / exitVoluntaryBySig: refunds go to the plan owner
 * only (there is no recipient parameter). Signature checks are NOT done here yet (owner: R3).
 */
export function escrowExit(chainPlanId: string, mode: "attested" | "voluntary", caller: string, idempotencyKey: string): Promise<MbResponse> {
  return idempotent(idempotencyKey, `escrow_exit_${mode}`, async (tx) => {
    const r = await tx.query("select * from mockbank.escrow_plans where chain_plan_id = $1 for update", [chainPlanId]);
    const p = r.rows[0];
    if (!p) throw new MockbankError(404, "plan_not_found");
    if (p.status !== "active") throw new MockbankError(409, "plan_not_active");
    const callerOk = caller.toLowerCase() === String(p.owner).toLowerCase() || caller.toLowerCase() === String(p.agent ?? "").toLowerCase();
    if (mode === "attested" && !callerOk) throw new MockbankError(403, "caller_not_owner_or_agent");
    const balance = BigInt(p.balance);
    const fee = mode === "voluntary" ? (balance * BigInt(p.cancel_fee_bps)) / BigInt(10000) : BigInt(0);
    const refund = balance - fee;
    const txId = `mock:${randomUUID()}`;
    await tx.query("update mockbank.escrow_plans set status = $2, balance = 0 where chain_plan_id = $1", [
      chainPlanId,
      mode === "attested" ? "exited_attested" : "exited_voluntary",
    ]);
    const body = {
      status: "confirmed",
      txHash: txId,
      chainPlanId,
      event: mode === "attested" ? "ExitedAttested" : "ExitedVoluntary",
      refundTo: p.owner,
      refund: refund.toString(),
      fee: fee.toString(),
    };
    return { status: 200, body };
  });
}

// ---- Test hooks -------------------------------------------------------------------------

export async function injectBill(
  customerId: string,
  b: { biller_id: string; amount: number; currency?: string; due_in_days?: number; period?: string; id?: string },
) {
  if (!Number.isInteger(b.amount) || b.amount <= 0) throw new MockbankError(400, "invalid_amount");
  return mbTx(async (tx) => {
    const id = b.id ?? randomUUID();
    const r = await tx.query(
      `insert into mockbank.bills (id, customer_id, biller_id, amount, currency, due_date, period, status)
       values ($1, $2, $3, $4, $5, current_date + $6::int, coalesce($7, to_char(current_date, 'YYYY-MM')), 'unpaid')
       returning id, biller_id, amount::int as amount, currency, due_date::text as due_date, period, status`,
      [id, customerId, b.biller_id, b.amount, b.currency ?? "CNY", b.due_in_days ?? 3, b.period ?? null],
    );
    await emit(tx, customerId, "bill.created", r.rows[0]);
    return r.rows[0];
  });
}

export async function injectTransaction(
  customerId: string,
  t: { amount: number; descriptor: string; currency?: string; original_amount?: number; original_currency?: string },
) {
  return mbTx(async (tx) => {
    const acct = await tx.query("select id from mockbank.accounts where customer_id = $1 and is_default", [customerId]);
    if (!acct.rowCount) throw new MockbankError(422, "no_default_account");
    const r = await tx.query(
      `insert into mockbank.transactions (account_id, posted_at, amount, currency, descriptor, original_amount, original_currency)
       values ($1, now(), $2, $3, $4, $5, $6) returning id, posted_at, amount, currency, descriptor`,
      [acct.rows[0].id, t.amount, t.currency ?? "CNY", t.descriptor, t.original_amount ?? null, t.original_currency ?? null],
    );
    await emit(tx, customerId, "transaction.posted", r.rows[0]);
    return { ...r.rows[0], amount: Number(r.rows[0].amount) };
  });
}

export async function setDefaultBalance(customerId: string, balance: number) {
  const r = await getMockbankPool().query(
    "update mockbank.accounts set balance = $2 where customer_id = $1 and is_default returning id, balance",
    [customerId, balance],
  );
  if (!r.rowCount) throw new MockbankError(404, "account_not_found");
  return { id: r.rows[0].id, balance: Number(r.rows[0].balance) };
}

export async function setTrialEnd(customerId: string, subscriptionId: string, inHours: number) {
  return mbTx(async (tx) => {
    const r = await tx.query(
      `update mockbank.subscriptions set status = 'trial', trial_end = now() + make_interval(hours => $3::int)
        where id = $1 and customer_id = $2 returning id, status, trial_end`,
      [subscriptionId, customerId, inHours],
    );
    if (!r.rowCount) throw new MockbankError(404, "subscription_not_found");
    await emit(tx, customerId, "subscription.trial_ending", r.rows[0]);
    return r.rows[0];
  });
}

export async function logCall(entry: {
  method: string;
  path: string;
  query: string;
  request: unknown;
  status: number;
  response: unknown;
  latencyMs: number;
}) {
  await getMockbankPool().query(
    `insert into mockbank.call_log (method, path, query, request_json, status, response_json, latency_ms)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      entry.method,
      entry.path,
      entry.query,
      entry.request === undefined ? null : JSON.stringify(entry.request),
      entry.status,
      entry.response === undefined ? null : JSON.stringify(entry.response),
      Math.round(entry.latencyMs),
    ],
  );
}
