// Owner: R2 (roles.md). Activity feed and "Why?" (architecture §13, §15.3; PRD §18.1 #2, G7).
// Built from action rows (args_json, gate_json, result_json), registry names looked up by id and
// the hash-chained audit log. No model text: copy comes from ./templates.

import type { PoolClient } from "pg";
import type { GateResult } from "@/src/core/types";
import { withUserTx } from "@/src/server/db/pool";
import { chainTxRef } from "@/src/server/db/read/db";
import type { ChainTxRef, Money } from "@/src/server/api-types";
import { headline, reasonText, tierOf, type Tier } from "./templates";

export type FeedItem = {
  id: string; // action id
  planId: string;
  tool: string;
  actor: "agent" | "user";
  tier: Tier;
  status: string;
  title: string;
  subject: { kind: "bill" | "subscription" | "prepaid_plan"; id: string; name: string | null } | null;
  amount: Money | null;
  ruleIds: string[];
  /** First reason in plain words, with what would make it allowed (denials). */
  reason: { why: string; fix?: string } | null;
  mandateVersion: number;
  tx: ChainTxRef | null;
  createdAt: string;
  executedAt: string | null;
};
export type FeedResponse = { items: FeedItem[] };

export type WhyResponse = {
  item: FeedItem;
  decision: GateResult["decision"] | null;
  mandate: { version: number; hash: string | null };
  trace: { ruleId: string; result: string; text: string; fix?: string }[];
  audit: { seq: number; actor: string; eventType: string; hash: string; prevHash: string; createdAt: string }[];
  argsHash: string;
  idempotencyKey: string;
};

type Row = {
  id: string;
  plan_id: string;
  tool: string;
  actor: "agent" | "user";
  args_json: Record<string, unknown>;
  args_hash: string;
  idempotency_key: string;
  mandate_version: number;
  status: string;
  decision: string | null;
  preview_decision: string | null;
  rule_ids: string[] | null;
  gate_json: GateResult | null;
  result_json: Record<string, unknown> | null;
  created_at: Date;
  executed_at: Date | null;
  bill_name: string | null;
  bill_currency: string | null;
  sub_name: string | null;
  sub_amount: number | null;
  sub_currency: string | null;
  plan_merchant: string | null;
  base_currency: string;
};

// Names come from registry/merchant tables by id; ids in args are lookup keys only.
const SELECT = `
  select a.id, a.plan_id, a.tool, a.actor, a.args_json, a.args_hash, a.idempotency_key, a.mandate_version,
         a.status, a.decision, a.preview_decision, a.rule_ids, a.gate_json, a.result_json, a.created_at, a.executed_at,
         br.name as bill_name, b.currency as bill_currency,
         m.canonical_name as sub_name, s.amount::float8 as sub_amount, s.currency as sub_currency,
         pm.name as plan_merchant, u.base_currency
    from public.actions a
    join public.users u on u.id = a.user_id
    left join public.bills b on a.tool = 'pay_bill' and b.id::text = a.args_json->>'bill_id' and b.user_id = a.user_id
    left join public.billers br on br.id = b.biller_id and br.user_id = b.user_id
    left join public.subscriptions s on a.tool = 'cancel_subscription' and s.id::text = a.args_json->>'subscription_id' and s.user_id = a.user_id
    left join public.merchants m on m.id = s.merchant_id
    left join public.prepaid_plans p on a.tool like 'prepaid_%' and p.id::text = a.args_json->>'plan_id' and p.user_id = a.user_id
    left join public.prepaid_merchants pm on pm.id = p.merchant_id`;

function toItem(r: Row): FeedItem {
  const approved = (r.rule_ids ?? []).includes("approval.valid");
  const tier = tierOf(r.status, r.decision ?? r.preview_decision, approved);
  const a = r.args_json ?? {};
  let subject: FeedItem["subject"] = null;
  let amount: Money | null = null;
  if (r.tool === "pay_bill") {
    subject = { kind: "bill", id: String(a.bill_id ?? ""), name: r.bill_name };
    if (typeof a.amount === "number") amount = { amount: a.amount, currency: r.bill_currency ?? r.base_currency };
  } else if (r.tool === "cancel_subscription") {
    subject = { kind: "subscription", id: String(a.subscription_id ?? ""), name: r.sub_name };
    if (r.sub_amount !== null) amount = { amount: r.sub_amount, currency: r.sub_currency ?? r.base_currency };
  } else if (r.tool.startsWith("prepaid_")) {
    subject = { kind: "prepaid_plan", id: String(a.plan_id ?? ""), name: r.plan_merchant };
  }
  const reasons = r.gate_json?.reasons ?? [];
  const firstReason = reasons[0] ?? (tier === "waiting" ? "approval.missing" : null);
  const txHash = typeof r.result_json?.txHash === "string" ? r.result_json.txHash : null;
  return {
    id: r.id,
    planId: r.plan_id,
    tool: r.tool,
    actor: r.actor,
    tier,
    status: r.status,
    title: headline(r.tool, subject?.name ?? null, tier),
    subject,
    amount,
    ruleIds: r.rule_ids ?? [],
    reason: tier === "auto" || tier === "approved" || !firstReason ? null : reasonText(firstReason),
    mandateVersion: r.mandate_version,
    tx: txHash ? chainTxRef(txHash) : null,
    createdAt: r.created_at.toISOString(),
    executedAt: r.executed_at ? r.executed_at.toISOString() : null,
  };
}

/** Actions the user can see in the feed, newest first. Planned-only rows are hidden. */
export function listFeed(userId: string, limit = 50): Promise<FeedResponse> {
  return withUserTx(userId, async (tx) => {
    const r = await tx.query<Row>(
      `${SELECT} where a.user_id = $1 and a.status <> 'planned' order by coalesce(a.executed_at, a.created_at) desc limit $2`,
      [userId, Math.min(Math.max(limit, 1), 200)],
    );
    return { items: r.rows.map(toItem) };
  });
}

async function auditFor(tx: PoolClient, userId: string, actionId: string) {
  const r = await tx.query(
    `select seq, actor, event_type, hash, prev_hash, created_at from public.audit_log
      where user_id = $1 and event_json->>'actionId' = $2 order by seq`,
    [userId, actionId],
  );
  return r.rows.map((x) => ({
    seq: Number(x.seq),
    actor: x.actor as string,
    eventType: x.event_type as string,
    hash: x.hash as string,
    prevHash: x.prev_hash as string,
    createdAt: (x.created_at as Date).toISOString(),
  }));
}

/** Decision trace for one action (G7): Gate trace from the last decision + its audit rows. */
export function whyFor(userId: string, actionId: string): Promise<WhyResponse | null> {
  return withUserTx(userId, async (tx) => {
    const r = await tx.query<Row>(`${SELECT} where a.user_id = $1 and a.id = $2`, [userId, actionId]);
    const row = r.rows[0];
    if (!row) return null;
    const gate = row.gate_json;
    return {
      item: toItem(row),
      decision: gate?.decision ?? null,
      mandate: { version: gate?.mandateVersion ?? row.mandate_version, hash: gate?.mandateHash ?? null },
      trace: (gate?.trace ?? []).map((t) => {
        const txt = t.reason ? reasonText(t.reason) : null;
        return { ruleId: t.ruleId, result: t.result, text: txt?.why ?? (t.result === "allow" ? "passed" : t.result), ...(txt?.fix ? { fix: txt.fix } : {}) };
      }),
      audit: await auditFor(tx, userId, actionId),
      argsHash: row.args_hash,
      idempotencyKey: row.idempotency_key,
    };
  });
}
