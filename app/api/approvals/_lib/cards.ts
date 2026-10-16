// Owner: R2 (roles.md). Minimal version by R1; extend, don't duplicate.
// Approval cards (architecture §6.3 create_approval, §8.3, §15.3; PRD §10.5). Every field
// comes from the action row (`actions.args_json`, hash-bound) and registry/DB lookups by id:
// payee names from the biller registry, merchant names from the merchant tables. No LLM text
// ever reaches a card. Types should move to src/server/api-types.ts (R2) when it is extended.

import type { PoolClient } from "pg";
import type { ResumeResponse } from "@/src/server/api-types";
import { withUserTx } from "@/src/server/db/pool";

export type Money = { amount: number; currency: string };

export type ApprovalCard = {
  id: string;
  actionId: string;
  planId: string;
  tool: string;
  /** Fixed template per tool, never model text. */
  title: string;
  payee: { id: string; name: string; source: "registry" } | null;
  amount: Money | null;
  subject:
    | { kind: "bill"; id: string; dueDate: string | null; period: string | null }
    | { kind: "subscription"; id: string; nextRenewal: string | null; status: string | null }
    | { kind: "prepaid_plan"; id: string; unitsLeft: number | null; unitsTotal: number | null; escrowBalance: Money | null }
    | null;
  attestation: { kind: string; issuedAt: string; sigValid: boolean; simulated: boolean } | null;
  decision: string | null;
  ruleIds: string[];
  mandateVersion: number;
  actionHash: string;
  createdAt: string;
  expiresAt: string;
};

export type ApprovalsResponse = { items: ApprovalCard[] };

/** POST /api/approvals/:id response. `resume` is null when the plan could not be resumed. */
export type DecisionResponse = {
  approvalId: string;
  status: "approved" | "rejected";
  planId: string | null;
  resume: ResumeResponse | null;
};

const TITLES: Record<string, string> = {
  pay_bill: "Pay bill",
  cancel_subscription: "Cancel subscription",
  prepaid_exit: "Exit prepaid plan",
  prepaid_exit_voluntary: "Exit prepaid plan",
  sweep_to_savings: "Move to savings",
};

export type ApprovalRow = {
  id: string;
  action_id: string;
  plan_id: string;
  tool: string;
  args_json: Record<string, unknown> | null;
  action_hash: string;
  mandate_version: number;
  rule_ids: string[] | null;
  decision: string | null;
  base_currency: string;
  created_at: Date | string;
  expires_at: Date | string;
};

/** Facts looked up by id from the user's own rows and the registries. */
export type CardLookups = {
  bill?: { id: string; billerId: string; billerName: string | null; currency: string; dueDate: string | null; period: string | null } | null;
  subscription?: { id: string; merchantName: string; amount: number; currency: string; nextRenewal: string | null; status: string } | null;
  prepaid?: {
    id: string;
    merchantId: string;
    merchantName: string;
    unitPrice: number; // fen
    unitsTotal: number;
    unitsRedeemed: number;
  } | null;
  attestation?: { kind: string; issuedAt: string; sigValid: boolean; simulated: boolean } | null;
};

const iso = (v: Date | string) => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());
const str = (v: unknown) => (typeof v === "string" ? v : null);

/** Pure: builds one card from the action row and lookups. Unknown args are ignored. */
export function buildCard(row: ApprovalRow, l: CardLookups): ApprovalCard {
  const args = row.args_json ?? {};
  const card: ApprovalCard = {
    id: row.id,
    actionId: row.action_id,
    planId: row.plan_id,
    tool: row.tool,
    title: TITLES[row.tool] ?? "Action",
    payee: null,
    amount: null,
    subject: null,
    attestation: null,
    decision: row.decision,
    ruleIds: row.rule_ids ?? [],
    mandateVersion: row.mandate_version,
    actionHash: row.action_hash,
    createdAt: iso(row.created_at),
    expiresAt: iso(row.expires_at),
  };

  if (row.tool === "pay_bill" && l.bill) {
    // The payee shown is the BILL's registry biller; the executor pays exactly that one.
    card.payee = l.bill.billerName ? { id: l.bill.billerId, name: l.bill.billerName, source: "registry" } : null;
    card.amount = typeof args.amount === "number" ? { amount: args.amount, currency: l.bill.currency } : null;
    card.subject = { kind: "bill", id: l.bill.id, dueDate: l.bill.dueDate, period: l.bill.period };
  }
  if (row.tool === "cancel_subscription" && l.subscription) {
    card.payee = null;
    card.amount = { amount: l.subscription.amount, currency: l.subscription.currency };
    card.subject = { kind: "subscription", id: l.subscription.id, nextRenewal: l.subscription.nextRenewal, status: l.subscription.status };
    card.title = `${TITLES.cancel_subscription}: ${l.subscription.merchantName}`;
  }
  if (row.tool.startsWith("prepaid_") && l.prepaid) {
    const p = l.prepaid;
    const unitsLeft = p.unitsTotal - p.unitsRedeemed;
    card.payee = { id: p.merchantId, name: p.merchantName, source: "registry" };
    card.subject = {
      kind: "prepaid_plan",
      id: p.id,
      unitsLeft,
      unitsTotal: p.unitsTotal,
      // Escrow balance in base units (fen / 100); the refund always goes to the plan owner.
      escrowBalance: { amount: (p.unitPrice * unitsLeft) / 100, currency: row.base_currency },
    };
    card.attestation = l.attestation ?? null;
  }
  // Ids from args are used only as lookup keys; if a lookup failed the card shows no subject.
  return card;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function lookups(tx: PoolClient, userId: string, row: ApprovalRow): Promise<CardLookups> {
  const args = row.args_json ?? {};
  if (row.tool === "pay_bill") {
    const billId = str(args.bill_id);
    if (!billId || !UUID_RE.test(billId)) return { bill: null };
    const r = await tx.query(
      `select b.id, b.biller_id, br.name as biller_name, b.currency, b.due_date::text as due_date, b.period
         from public.bills b left join public.billers br on br.id = b.biller_id and br.user_id = b.user_id
        where b.id = $1 and b.user_id = $2`,
      [billId, userId],
    );
    const b = r.rows[0];
    return {
      bill: b ? { id: b.id, billerId: b.biller_id, billerName: b.biller_name, currency: b.currency, dueDate: b.due_date, period: b.period } : null,
    };
  }
  if (row.tool === "cancel_subscription") {
    const id = str(args.subscription_id);
    if (!id || !UUID_RE.test(id)) return { subscription: null };
    const r = await tx.query(
      `select s.id, m.canonical_name, s.amount::float8 as amount, s.currency, s.next_renewal::text as next_renewal, s.status
         from public.subscriptions s join public.merchants m on m.id = s.merchant_id
        where s.id = $1 and s.user_id = $2`,
      [id, userId],
    );
    const s = r.rows[0];
    return {
      subscription: s
        ? { id: s.id, merchantName: s.canonical_name, amount: Number(s.amount), currency: s.currency, nextRenewal: s.next_renewal, status: s.status }
        : null,
    };
  }
  if (row.tool.startsWith("prepaid_")) {
    const id = str(args.plan_id);
    if (!id || !UUID_RE.test(id)) return { prepaid: null };
    const r = await tx.query(
      `select p.id, p.merchant_id, m.name, p.unit_price::float8 as unit_price, p.units_total, p.units_redeemed
         from public.prepaid_plans p join public.prepaid_merchants m on m.id = p.merchant_id
        where p.id = $1 and p.user_id = $2`,
      [id, userId],
    );
    const p = r.rows[0];
    if (!p) return { prepaid: null };
    const a = await tx.query(
      `select kind, issued_at, sig_valid, coalesce((raw_json->>'simulated')::boolean, false) as simulated
         from public.attestations where merchant_id = $1 and sig_valid order by issued_at desc limit 1`,
      [p.merchant_id],
    );
    const att = a.rows[0];
    return {
      prepaid: {
        id: p.id,
        merchantId: p.merchant_id,
        merchantName: p.name,
        unitPrice: Number(p.unit_price),
        unitsTotal: p.units_total,
        unitsRedeemed: p.units_redeemed,
      },
      attestation: att ? { kind: att.kind, issuedAt: iso(att.issued_at), sigValid: att.sig_valid, simulated: att.simulated } : null,
    };
  }
  return {};
}

/** Pending, unexpired approvals of the session user, as cards. */
export function listPendingCards(userId: string): Promise<ApprovalCard[]> {
  return withUserTx(userId, async (tx) => {
    const r = await tx.query<ApprovalRow>(
      `select ap.id, ap.action_id, a.plan_id, a.tool, a.args_json, ap.action_hash, ap.mandate_version,
              a.rule_ids, coalesce(a.decision, a.preview_decision) as decision, u.base_currency,
              ap.created_at, ap.expires_at
         from public.approvals ap
         join public.actions a on a.id = ap.action_id and a.user_id = ap.user_id
         join public.users u on u.id = ap.user_id
        where ap.user_id = $1 and ap.status = 'pending' and ap.expires_at > now()
        order by ap.created_at
        limit 100`,
      [userId],
    );
    const cards: ApprovalCard[] = [];
    for (const row of r.rows) cards.push(buildCard(row, await lookups(tx, userId, row)));
    return cards;
  });
}

/** The plan an action belongs to (session user only). */
export function planIdForAction(userId: string, actionId: string): Promise<string | null> {
  return withUserTx(userId, async (tx) => {
    const r = await tx.query<{ plan_id: string }>("select plan_id from public.actions where id = $1 and user_id = $2", [actionId, userId]);
    return r.rows[0]?.plan_id ?? null;
  });
}
