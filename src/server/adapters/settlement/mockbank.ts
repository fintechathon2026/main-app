// Owner: R3 (roles.md). Minimal version by R1; extend, don't duplicate.
// Mock bank settlement adapter (architecture §8.4) and mock EscrowAdapter (§24.13), both over
// the /mockbank HTTP API with MOCKBANK_API_KEY. Imported only by src/server/executor/**.
// The destination is never sent: the bank resolves it from biller_id in its own registry.

import type {
  ChainResult,
  EscrowAdapter,
  EscrowPlanState,
  EscrowSendOpts,
  SettlementAdapter,
  SettlementOpts,
  SettlementResult,
} from "./types";
import { SettlementError } from "./types";

/** Sends a Request to the mock bank. Default: fetch to $MOCKBANK_URL. Tests pass an in-process one. */
export type MockbankTransport = (req: Request) => Promise<Response>;

export const fetchTransport: MockbankTransport = (req) => fetch(req);

type Cfg = { transport?: MockbankTransport; baseUrl?: string; apiKey?: string };

function client(cfg: Cfg) {
  const transport = cfg.transport ?? fetchTransport;
  const baseUrl = cfg.baseUrl ?? process.env.MOCKBANK_URL ?? "http://localhost:3000";
  const apiKey = cfg.apiKey ?? process.env.MOCKBANK_API_KEY ?? "";
  return async (method: "GET" | "POST", path: string, opts: { body?: unknown; customerId?: string; idempotencyKey?: string } = {}) => {
    const headers: Record<string, string> = { "x-api-key": apiKey, "content-type": "application/json" };
    if (opts.customerId) headers["x-customer-id"] = opts.customerId;
    if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey;
    let res: Response;
    try {
      res = await transport(
        new Request(`${baseUrl.replace(/\/$/, "")}/mockbank${path}`, {
          method,
          headers,
          body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        }),
      );
    } catch (e) {
      // Network failure: the request may or may not have reached the bank.
      throw new SettlementError("network_error", false, String(e));
    }
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return { status: res.status, json };
  };
}

function settle(r: { status: number; json: Record<string, unknown> | null }, refField: string): SettlementResult {
  if (r.status >= 200 && r.status < 300 && r.json) {
    return { status: "succeeded", reference: String(r.json[refField] ?? ""), raw: r.json };
  }
  const code = String(r.json?.error ?? `http_${r.status}`);
  // 4xx: the bank refused and stored that result; 5xx or no body: outcome unknown.
  throw new SettlementError(code, r.status >= 400 && r.status < 500, r.json);
}

export function createMockbankSettlement(cfg: Cfg = {}): SettlementAdapter {
  const call = client(cfg);
  return {
    async payBill(a, o: SettlementOpts) {
      const r = await call("POST", "/payments", {
        customerId: o.customerId,
        idempotencyKey: o.idempotencyKey,
        body: { bill_id: a.billId, biller_id: a.billerId, amount: a.amount, idempotency_key: o.idempotencyKey },
      });
      return settle(r, "payment_id");
    },
    async cancelSubscription(a, o) {
      const r = await call("POST", `/subscriptions/${encodeURIComponent(a.subscriptionId)}/cancel`, {
        customerId: o.customerId,
        idempotencyKey: o.idempotencyKey,
        body: {},
      });
      return settle(r, "confirmation");
    },
    async transferInternal(a, o) {
      // Amount only: the bank sweeps to the customer's own savings account.
      const r = await call("POST", "/transfers/internal", {
        customerId: o.customerId,
        idempotencyKey: o.idempotencyKey,
        body: { amount: a.amount, idempotency_key: o.idempotencyKey },
      });
      return settle(r, "transfer_id");
    },
    async lookup(idempotencyKey) {
      const r = await call("GET", `/operations/${encodeURIComponent(idempotencyKey)}`);
      if (r.status === 404) return null;
      const inner = r.json as { status_code?: number; response?: Record<string, unknown> } | null;
      if (!inner?.status_code || inner.status_code >= 300) return null;
      const ref = inner.response?.payment_id ?? inner.response?.confirmation ?? inner.response?.transfer_id ?? "";
      return { status: "succeeded", reference: String(ref), raw: inner.response };
    },
  };
}

/** Mock escrow over mockbank.escrow_plans; ids are `mock:<uuid>` instead of tx hashes. */
export function createMockEscrow(cfg: Cfg & { agentAddress?: string } = {}): EscrowAdapter {
  const call = client(cfg);
  const agent = cfg.agentAddress ?? process.env.AGENT_ADDRESS ?? "";
  const toChain = (r: { status: number; json: Record<string, unknown> | null }): ChainResult => {
    if (r.status === 200 && r.json?.status === "confirmed") {
      return { status: "confirmed", txHash: String(r.json.txHash), blockNumber: null, events: [r.json] };
    }
    if (r.status >= 400 && r.status < 500) return { status: "reverted", txHash: null, reason: String(r.json?.error ?? r.status) };
    return { status: "pending", txHash: "mock:unknown" };
  };
  return {
    async readPlan(chainPlanId): Promise<EscrowPlanState | null> {
      const r = await call("GET", `/escrow/plans/${encodeURIComponent(chainPlanId)}`);
      if (r.status === 404) return null;
      if (r.status !== 200 || !r.json) throw new SettlementError("escrow_read_failed", false, r.json);
      const p = r.json.plan as Record<string, unknown>;
      return {
        chainPlanId: String(p.chain_plan_id),
        owner: String(p.owner),
        merchant: String(p.merchant),
        agent: (p.agent as string | null) ?? null,
        status: p.status as EscrowPlanState["status"],
        unitPrice: Number(p.unit_price),
        unitsTotal: Number(p.units_total),
        unitsRedeemed: Number(p.units_redeemed),
      };
    },
    async purchase(a, o: EscrowSendOpts) {
      // Relayed: the escrow verifies both signatures; the plan owner is whoever signed `auth`.
      const r = await call("POST", "/escrow/purchase", {
        idempotencyKey: o.idempotencyKey,
        body: {
          offer: a.offer,
          merchantSig: a.merchantSig,
          auth: a.auth,
          consumerSig: a.consumerSig,
          ...(a.permit === undefined ? {} : { permit: a.permit }),
          idempotency_key: o.idempotencyKey,
        },
      });
      return toChain(r);
    },
    async redeem(a, o) {
      const r = await call("POST", `/escrow/plans/${encodeURIComponent(a.chainPlanId)}/redeem`, {
        idempotencyKey: o.idempotencyKey,
        body: {
          sessionNo: a.sessionNo,
          deadline: a.deadline,
          consumerSig: a.consumerSig,
          merchantSig: a.merchantSig,
          idempotency_key: o.idempotencyKey,
        },
      });
      return toChain(r);
    },
    async exitWithAttestation(a, o: EscrowSendOpts) {
      // Sent from the agent address, like the real exitWithAttestation (agent key). The escrow
      // re-verifies the oracle signature on `attestation`; the id is for the call log.
      const r = await call("POST", `/escrow/plans/${encodeURIComponent(a.chainPlanId)}/exit-attested`, {
        idempotencyKey: o.idempotencyKey,
        body: { caller: agent, attestation_id: a.attestationId, attestation: a.attestation, idempotency_key: o.idempotencyKey },
      });
      return toChain(r);
    },
    async exitVoluntary(a, o) {
      const r = await call("POST", `/escrow/plans/${encodeURIComponent(a.chainPlanId)}/exit-voluntary`, {
        idempotencyKey: o.idempotencyKey,
        body: {
          caller: agent,
          deadline: a.deadline,
          consumerSig: a.consumerSig,
          idempotency_key: o.idempotencyKey,
        },
      });
      return toChain(r);
    },
    async lookup(idempotencyKey) {
      const r = await call("GET", `/operations/${encodeURIComponent(idempotencyKey)}`);
      if (r.status !== 200) return null;
      const inner = r.json as { status_code?: number; response?: Record<string, unknown> } | null;
      return toChain({ status: inner?.status_code ?? 500, json: inner?.response ?? null });
    },
  };
}
