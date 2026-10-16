// Prepaid plans, sessions and offers (architecture §24.8). Plans and sessions are indexed from
// the escrow contract (`origin = 'chain'`); offers are merchant-signed (simulated merchant in v1).
// Money columns are in fen; converted to yuan by the services.

import { z } from "zod";
import { type Queryable, parseRows, zNum, zNumOrNull, zTs } from "./db";

export const RISK_LEVELS = ["none", "watch", "elevated"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const PrepaidPlanRow = z.object({
  id: z.string(),
  chain_plan_id: z.string(),
  merchant_id: z.string(),
  merchant_name: z.string().nullable(),
  merchant_risk_level: z.enum(RISK_LEVELS),
  unit_price: zNum, // fen
  units_total: z.number().int(),
  units_redeemed: z.number().int(),
  cancel_fee_bps: z.number().int(),
  agent_address: z.string().nullable(),
  status: z.enum(["active", "completed", "exited_attested", "exited_voluntary"]),
  purchase_tx: z.string(),
  origin: z.literal("chain"),
});
export type PrepaidPlanRow = z.output<typeof PrepaidPlanRow>;

export const PrepaidSessionRow = z.object({
  plan_id: z.string(),
  session_no: z.number().int(),
  tx_hash: z.string(),
  redeemed_at: zTs,
});
export type PrepaidSessionRow = z.output<typeof PrepaidSessionRow>;

export async function listPrepaidPlans(q: Queryable, userId: string): Promise<PrepaidPlanRow[]> {
  const { rows } = await q.query(
    `select p.id::text as id, p.chain_plan_id::text as chain_plan_id, p.merchant_id,
            coalesce(pm.name, m.canonical_name) as merchant_name, pm.risk_level as merchant_risk_level,
            p.unit_price::text as unit_price, p.units_total, p.units_redeemed, p.cancel_fee_bps,
            p.agent_address, p.status, p.purchase_tx, p.origin
       from public.prepaid_plans p
       join public.prepaid_merchants pm on pm.id = p.merchant_id
       left join public.merchants m on m.id = pm.merchant_id
      where p.user_id = $1
      order by (p.status = 'active') desc, p.chain_plan_id`,
    [userId],
  );
  return parseRows(PrepaidPlanRow, rows, "prepaid_plans");
}

export async function listPrepaidSessions(q: Queryable, userId: string): Promise<PrepaidSessionRow[]> {
  const { rows } = await q.query(
    `select s.plan_id::text as plan_id, s.session_no, s.tx_hash, s.redeemed_at::text as redeemed_at
       from public.prepaid_sessions s
      where s.user_id = $1
      order by s.plan_id, s.session_no`,
    [userId],
  );
  return parseRows(PrepaidSessionRow, rows, "prepaid_sessions");
}

/** Fields read from the merchant-signed `offer_json` (shape owned by the simulator, R3). */
export const OfferJson = z
  .object({
    merchantName: z.string().optional(),
    payPerVisitPrice: zNum.optional(), // fen
    currency: z.string().optional(),
  })
  .loose();

export const PrepaidOfferRow = z.object({
  id: z.string(),
  merchant_id: z.string(),
  merchant_name: z.string().nullable(),
  escrow_supported: z.boolean(),
  merchant_risk_level: z.enum(RISK_LEVELS),
  unit_price: zNum, // fen
  units: z.number().int(),
  cancel_fee_bps: z.number().int(),
  pay_per_visit_price: zNumOrNull, // fen; falls back to offer_json.payPerVisitPrice
  expires_at: zTs,
  offer_json: OfferJson,
});
export type PrepaidOfferRow = z.output<typeof PrepaidOfferRow>;

const OFFER_SELECT = `select o.id::text as id, o.merchant_id, coalesce(pm.name, m.canonical_name) as merchant_name,
            pm.escrow_supported, pm.risk_level as merchant_risk_level, o.unit_price::text as unit_price,
            o.units, o.cancel_fee_bps, o.pay_per_visit_price::text as pay_per_visit_price,
            o.expires_at::text as expires_at, o.offer_json
       from public.prepaid_offers o
       join public.prepaid_merchants pm on pm.id = o.merchant_id
       left join public.merchants m on m.id = pm.merchant_id`;

/** Offers not yet expired at `now`. */
export async function listPrepaidOffers(q: Queryable, now: string): Promise<PrepaidOfferRow[]> {
  const { rows } = await q.query(`${OFFER_SELECT} where o.expires_at > $1::timestamptz order by o.merchant_id, o.id`, [now]);
  return parseRows(PrepaidOfferRow, rows, "prepaid_offers");
}

export async function getPrepaidOffer(q: Queryable, id: string): Promise<PrepaidOfferRow | null> {
  const { rows } = await q.query(`${OFFER_SELECT} where o.id::text = $1`, [id]);
  return parseRows(PrepaidOfferRow, rows, "prepaid_offers")[0] ?? null;
}
