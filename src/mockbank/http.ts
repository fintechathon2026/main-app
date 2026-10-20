// Owner: R3 (roles.md). Minimal version by R1; extend, don't duplicate.
// HTTP surface of the mock bank (PRD §14.1), mounted at /mockbank/* by
// app/mockbank/[...path]/route.ts. Auth: `x-api-key: $MOCKBANK_API_KEY`. Customer-scoped
// routes need `x-customer-id` (the bank customer = the app user id). Every call is logged to
// mockbank.call_log with request, response, latency and customer id, except the export itself
// (GET /call-log), which returns the log as JSONL or CSV.

import { timingSafeEqual } from "node:crypto";
import { toCsv, toJsonl } from "@/src/core/export/serialize";
import {
  CALL_LOG_COLUMNS,
  MockbankError,
  cancelSubscription,
  createPayment,
  injectBill,
  injectTransaction,
  listAccounts,
  listBillers,
  listBills,
  listEvents,
  listSubscriptions,
  listTransactions,
  logCall,
  listCallLog,
  lookupOperation,
  reverseTransfer,
  transferInternal,
  type MbResponse,
} from "./bank";
import { escrowExitAttested, escrowExitVoluntary, escrowPurchase, escrowRedeem, getEscrowPlan } from "./escrow";
import { listScenarios, scenarios } from "./scenarios";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function apiKeyOk(req: Request): boolean {
  const expected = process.env.MOCKBANK_API_KEY;
  if (!expected) return false;
  const got = req.headers.get("x-api-key") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function testRoutesEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.MOCKBANK_ENABLE_TEST_ROUTES === "1";
}

function customer(req: Request): string {
  const c = req.headers.get("x-customer-id") ?? "";
  if (!UUID_RE.test(c)) throw new MockbankError(400, "customer_id_required");
  return c;
}

const ok = (body: unknown, status = 200): MbResponse => ({ status, body });

const EXPORT_MAX = 5000;

/** GET /call-log?format=jsonl|csv&customer=<uuid>&since=<id>&limit=<n> (FR10.4). */
async function exportCallLog(url: URL): Promise<MbResponse> {
  const format = url.searchParams.get("format") ?? "jsonl";
  if (format !== "jsonl" && format !== "csv") throw new MockbankError(400, "invalid_format");
  const customerId = url.searchParams.get("customer") ?? undefined;
  if (customerId !== undefined && !UUID_RE.test(customerId)) throw new MockbankError(400, "invalid_customer");
  const since = Number(url.searchParams.get("since") ?? 0);
  const limit = Number(url.searchParams.get("limit") ?? EXPORT_MAX);
  const rows = await listCallLog({
    customerId,
    since: Number.isInteger(since) && since > 0 ? since : 0,
    limit: Number.isInteger(limit) && limit > 0 ? Math.min(limit, EXPORT_MAX) : EXPORT_MAX,
  });
  const raw =
    format === "csv"
      ? { text: toCsv(CALL_LOG_COLUMNS, rows), contentType: "text/csv; charset=utf-8", filename: "mockbank-call-log.csv" }
      : { text: toJsonl(rows), contentType: "application/x-ndjson; charset=utf-8", filename: "mockbank-call-log.jsonl" };
  return { status: 200, body: { rows: rows.length }, raw };
}

async function route(req: Request, path: string[], body: Record<string, unknown> | undefined): Promise<MbResponse> {
  const url = new URL(req.url);
  const q = (k: string) => url.searchParams.get(k) ?? undefined;
  const m = req.method;
  const [p0, p1, p2, p3] = path;
  const idemKey = (req.headers.get("idempotency-key") ?? (body?.idempotency_key as string | undefined) ?? "").trim();

  if (m === "GET" && p0 === "accounts" && path.length === 1) return ok({ accounts: await listAccounts(customer(req)) });
  if (m === "GET" && p0 === "accounts" && p2 === "transactions" && path.length === 3) {
    if (!UUID_RE.test(p1)) throw new MockbankError(404, "account_not_found");
    return ok({ transactions: await listTransactions(customer(req), p1, q("from"), q("to")) });
  }
  if (m === "GET" && p0 === "billers" && path.length === 1) return ok({ billers: await listBillers() });
  if (m === "GET" && p0 === "bills" && path.length === 1) return ok({ bills: await listBills(customer(req), q("status")) });
  if (m === "POST" && p0 === "payments" && path.length === 1) {
    return createPayment(customer(req), {
      bill_id: String(body?.bill_id ?? ""),
      biller_id: String(body?.biller_id ?? ""),
      amount: Number(body?.amount),
      idempotency_key: idemKey,
    });
  }
  if (m === "GET" && p0 === "operations" && path.length === 2) {
    const r = await lookupOperation(decodeURIComponent(p1));
    if (!r) throw new MockbankError(404, "operation_not_found");
    return ok({ status_code: r.status, response: r.body });
  }
  if (m === "GET" && p0 === "subscriptions" && path.length === 1) return ok({ subscriptions: await listSubscriptions(customer(req)) });
  if (m === "POST" && p0 === "subscriptions" && p2 === "cancel" && path.length === 3) {
    if (!UUID_RE.test(p1)) throw new MockbankError(404, "subscription_not_found");
    return cancelSubscription(customer(req), p1, idemKey);
  }
  if (m === "POST" && p0 === "transfers" && p1 === "internal" && path.length === 2) {
    // Only the amount is read: the bank picks the customer's own savings account (no destination field).
    // Non-numbers become NaN; bank.ts validates the amount as numeric(14,2) (at most two decimals).
    const amount = typeof body?.amount === "number" ? body.amount : NaN;
    return transferInternal(customer(req), { amount, idempotency_key: idemKey });
  }
  if (m === "POST" && p0 === "transfers" && p2 === "reverse" && path.length === 3) {
    if (!UUID_RE.test(p1)) throw new MockbankError(404, "transfer_not_found");
    return reverseTransfer(customer(req), p1, idemKey);
  }
  if (m === "GET" && p0 === "call-log" && path.length === 1) return exportCallLog(url);
  if (m === "GET" && p0 === "events" && path.length === 1) {
    const since = Number(q("since") ?? 0);
    return ok({ events: await listEvents(customer(req), Number.isFinite(since) ? since : 0) });
  }
  if (m === "POST" && p0 === "escrow" && p1 === "purchase" && path.length === 2) return escrowPurchase(body, idemKey);
  if (p0 === "escrow" && p1 === "plans" && /^\d{1,78}$/.test(p2 ?? "")) {
    if (m === "GET" && path.length === 3) return ok({ plan: await getEscrowPlan(p2) });
    if (m === "POST" && path.length === 4 && p3 === "redeem") return escrowRedeem(p2, body, idemKey);
    if (m === "POST" && path.length === 4 && p3 === "exit-attested") return escrowExitAttested(p2, body, idemKey);
    if (m === "POST" && path.length === 4 && p3 === "exit-voluntary") return escrowExitVoluntary(p2, body, idemKey);
  }
  if (p0 === "test") {
    if (!testRoutesEnabled()) throw new MockbankError(404, "not_found");
    if (m === "GET" && p1 === "scenarios" && path.length === 2) return ok({ scenarios: listScenarios() });
    if (m === "POST" && p1 === "scenarios" && p2 && path.length === 3) {
      const s = scenarios[p2];
      if (!s) throw new MockbankError(404, "unknown_scenario");
      return ok({ scenario: p2, result: await s.run(customer(req), body ?? {}) }, 201);
    }
    if (m === "POST" && p1 === "inject" && path.length === 2) {
      const c = customer(req);
      if (body?.kind === "bill") {
        return ok({ injected: await injectBill(c, body as Parameters<typeof injectBill>[1]) }, 201);
      }
      if (body?.kind === "transaction") {
        return ok({ injected: await injectTransaction(c, body as Parameters<typeof injectTransaction>[1]) }, 201);
      }
      throw new MockbankError(400, "unknown_inject_kind");
    }
  }
  throw new MockbankError(404, "not_found");
}

/** Entry point shared by the route handler and in-process test transports. */
export async function handleMockbankRequest(req: Request, path: string[]): Promise<Response> {
  const started = performance.now();
  const url = new URL(req.url);
  let body: Record<string, unknown> | undefined;
  let res: MbResponse;
  try {
    if (!process.env.MOCKBANK_API_KEY) throw new MockbankError(503, "mockbank_not_configured");
    if (!apiKeyOk(req)) throw new MockbankError(401, "invalid_api_key");
    if (req.method === "POST") {
      const text = await req.text();
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          throw new MockbankError(400, "invalid_json");
        }
      }
    }
    res = await route(req, path, body);
  } catch (e) {
    res =
      e instanceof MockbankError
        ? { status: e.status, body: { error: e.code, message: e.message } }
        : { status: 500, body: { error: "internal_error" } };
    if (!(e instanceof MockbankError)) console.error("mockbank error", e);
  }
  // Exports are not logged, so reading the log never grows it.
  const isExport = path.length === 1 && path[0] === "call-log";
  const customerHeader = req.headers.get("x-customer-id") ?? "";
  if (res.status !== 401 && res.status !== 503 && !isExport) {
    await logCall({
      method: req.method,
      path: "/" + path.join("/"),
      query: url.search,
      request: body,
      status: res.status,
      response: res.body,
      latencyMs: performance.now() - started,
      customerId: UUID_RE.test(customerHeader) ? customerHeader : null,
    }).catch((e) => console.error("mockbank call_log failed", e));
  }
  if (res.raw) {
    return new Response(res.raw.text, {
      status: res.status,
      headers: { "content-type": res.raw.contentType, "content-disposition": `attachment; filename="${res.raw.filename}"` },
    });
  }
  return Response.json(res.body, { status: res.status });
}
