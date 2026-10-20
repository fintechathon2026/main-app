// Owner: R2 (roles.md). Minimal version by R1; extend, don't duplicate.
// Builds the GateSnapshot from DB rows inside the execution transaction (architecture §7.1,
// §10.3). Provenance is re-derived from bill/biller/subscription rows by id; the LLM's
// arguments are only used as keys and compared against those rows, never trusted.

import type { PoolClient } from "pg";
import type { GateSnapshot, Origin, PrepaidFacts, TypedAction } from "@/src/core/types";
import { actionHash, hashPolicy } from "@/src/core/mandate/canonical";
import { parsePolicy, type Policy } from "@/src/core/mandate/schema";
import { approvalState } from "@/src/server/approvals";
import type { EscrowPlanState } from "@/src/server/adapters/settlement/types";
import { escrowDomainFromEnv, type OfferJson, type PurchaseAuthJson } from "@/src/server/chain/types";
import { recoverVoluntaryExitSigner, verifiedVoluntaryExitSignature } from "@/src/server/prepaid/exit-signature";
import { purchaseSignatureFacts } from "@/src/server/prepaid/purchase-signature";
import { verifyRedeemSignatures } from "@/src/server/prepaid/redeem-signature";
import { AttestationWire, recoverAttestationSigner } from "@/src/server/risk/attestation";
import { attestationDomainFromEnv, attestationKindFromCode } from "@/src/sim/registry/eip712";

export type ActionRow = {
  id: string;
  plan_id: string;
  user_id: string;
  tool: TypedAction["tool"];
  actor: "agent" | "user";
  args_json: Record<string, unknown>;
  args_hash: string;
  mandate_version: number;
  idempotency_key: string;
  status: string;
  preview_decision: string | null;
  decision: string | null;
  rule_ids: string[] | null;
  result_json: unknown;
};

export const ACTION_COLUMNS =
  "id, plan_id, user_id, tool, actor, args_json, args_hash, mandate_version, idempotency_key, status, preview_decision, decision, rule_ids, result_json";

export function typedAction(a: ActionRow): TypedAction {
  return { tool: a.tool, actor: a.actor, args: a.args_json } as TypedAction;
}

export function verifyActionHash(a: ActionRow): boolean {
  try {
    return actionHash(a.tool, a.args_json) === a.args_hash;
  } catch {
    return false;
  }
}

/** Phase A facts read outside the transaction (chain / mock escrow reads). */
export type PhaseAFacts = { escrowPlan?: EscrowPlanState | null };

export type UserCtx = { timezone: string; baseCurrency: string; day: string; now: string };

export async function userCtx(tx: PoolClient, userId: string): Promise<UserCtx> {
  const r = await tx.query(
    `select u.timezone, u.base_currency, (now() at time zone u.timezone)::date::text as day,
            to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as now
       from public.users u where u.id = $1`,
    [userId],
  );
  if (!r.rowCount) throw new Error("user_not_found");
  const u = r.rows[0];
  return { timezone: u.timezone, baseCurrency: u.base_currency, day: u.day, now: u.now };
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const DAY_MS = 86_400_000;

export async function buildSnapshot(
  tx: PoolClient,
  action: ActionRow,
  ctx: UserCtx,
  phaseA: PhaseAFacts = {},
): Promise<GateSnapshot> {
  const userId = action.user_id;
  const args = action.args_json;

  const ks = await tx.query("select enabled from public.kill_switch where user_id = $1", [userId]);
  const md = await tx.query(
    "select version, policy_json, policy_hash from public.mandates where user_id = $1 and status = 'active'",
    [userId],
  );
  const m = md.rows[0];
  // R0: no passkey yet, so "signature valid" = the stored hash matches the stored policy.
  const mandate = m
    ? { version: m.version as number, hash: m.policy_hash as string, policy: m.policy_json, signatureValid: hashPolicy(m.policy_json) === m.policy_hash }
    : null;
  const parsed = m ? parsePolicy(m.policy_json) : null;
  const policy = parsed?.ok ? parsed.policy : null;

  const lim = await tx.query("select used from public.daily_limits where user_id = $1 and day = $2", [userId, ctx.day]);

  const snap: GateSnapshot = {
    now: ctx.now,
    killSwitch: ks.rows[0]?.enabled === true,
    mandate,
    provenance: { destinationOrigin: null, amountOrigin: null, amountMatchesBill: false },
    payee: null,
    history: { amounts: [] },
    fx: null,
    caps: { dailyUsed: Number(lim.rows[0]?.used ?? 0), dailyCap: policy?.global.daily_outflow_cap ?? 0 },
    approval: await approvalState(tx, action.id, action.args_hash),
  };

  if (action.tool === "pay_bill") await payBillFacts(tx, snap, userId, args, ctx, policy?.global.per_payee_daily_cap);
  if (action.tool === "cancel_subscription") await subscriptionFacts(tx, snap, userId, str(args.subscription_id), ctx);
  if (action.tool === "prepaid_purchase") await purchaseFacts(tx, snap, action, ctx);
  else if (action.tool.startsWith("prepaid_")) await prepaidFacts(tx, snap, action, phaseA, ctx, policy);
  return snap;
}

async function payBillFacts(
  tx: PoolClient,
  snap: GateSnapshot,
  userId: string,
  args: Record<string, unknown>,
  ctx: UserCtx,
  perPayeeCaps: Record<string, number> | undefined,
) {
  const billId = str(args.bill_id);
  const billerArg = str(args.biller_id);
  const bill = /^[0-9a-f-]{36}$/i.test(billId)
    ? (
        await tx.query(
          "select id, biller_id, amount::int as amount, currency, amount_origin, status from public.bills where id = $1 and user_id = $2",
          [billId, userId],
        )
      ).rows[0]
    : undefined;
  if (!bill) return; // no bill row: destination and amount unknown -> deny

  const biller = (
    await tx.query(
      "select id, payee_account_ref, verified_at is not null as verified from public.billers where id = $1 and user_id = $2",
      [bill.biller_id, userId],
    )
  ).rows[0];

  // Destination: the registry entry for the BILL's biller; the arg must name the same biller.
  const destinationOk = !!biller && !!biller.payee_account_ref && bill.biller_id === billerArg;
  snap.provenance = {
    destinationOrigin: destinationOk ? "registry" : null,
    amountOrigin: bill.amount_origin as Origin,
    amountMatchesBill: bill.amount === args.amount && bill.status === "unpaid",
  };
  snap.payee = biller ? { billerId: biller.id, inRegistry: true, verified: biller.verified } : null;

  const hist = await tx.query(
    `select amount::int as amount from public.bills
      where user_id = $1 and biller_id = $2 and id <> $3 and status <> 'cancelled' and currency = $4
      order by due_date desc limit 12`,
    [userId, bill.biller_id, bill.id, bill.currency],
  );
  snap.history = { amounts: hist.rows.map((r) => r.amount as number) };

  if (bill.currency !== ctx.baseCurrency) {
    const fx = await tx.query(
      `select rate, date::text as date from public.fx_rates
        where base = $1 and quote = $2 and source = 'fx_provider' and date <= $3::date order by date desc limit 1`,
      [bill.currency, ctx.baseCurrency, ctx.day],
    );
    // Unknown rate -> epoch date so the Gate's fx.rate_fresh rule denies (see decide.ts header).
    snap.fx = fx.rowCount
      ? { rate: Number(fx.rows[0].rate), date: fx.rows[0].date, source: "fx_provider" }
      : { rate: 0, date: "1970-01-01", source: "fx_provider" };
  }

  if (perPayeeCaps?.[bill.biller_id] !== undefined) {
    const used = await tx.query(
      `select coalesce(sum(amount), 0)::bigint as used from public.cap_reservations
        where user_id = $1 and day = $2 and payee_id = $3 and status in ('reserved','committed')`,
      [userId, ctx.day, bill.biller_id],
    );
    snap.caps.perPayeeUsed = Number(used.rows[0].used);
    snap.caps.perPayeeCap = perPayeeCaps[bill.biller_id];
  }
}

async function subscriptionFacts(tx: PoolClient, snap: GateSnapshot, userId: string, subscriptionId: string, ctx: UserCtx) {
  if (!/^[0-9a-f-]{36}$/i.test(subscriptionId)) return;
  const r = await tx.query(
    `select status, trial_end, trial_status_origin, keep_flag, notice_sent from public.subscriptions where id = $1 and user_id = $2`,
    [subscriptionId, userId],
  );
  const s = r.rows[0];
  if (!s) return;
  const trialActive = s.status === "trial" && s.trial_end !== null && new Date(s.trial_end).getTime() > Date.parse(ctx.now);
  snap.subscription = {
    status: s.status,
    isTrial: trialActive,
    trialOrigin: (s.trial_status_origin as Origin | null) ?? null,
    keepFlag: s.keep_flag,
    noticeSent: s.notice_sent,
  };
  snap.provenance = { ...snap.provenance, trialStatusOrigin: snap.subscription.trialOrigin };
}

type AttestationCandidate = {
  id: string;
  kind: "court_enforcement" | "closure_notice";
  case_ref_hash: string;
  issued_at: Date;
  expires_at: Date;
  signature: string;
  raw_json: unknown;
};

/**
 * True only when the stored record is a well-formed EIP-712 attestation whose fields match the
 * row's columns and the merchant's chain address, and whose signature recovers to the oracle
 * (architecture §24.9). The stored sig_valid is a UI cache and is never used here.
 */
async function attestationVerifies(c: AttestationCandidate, merchantAddress: string, oracle: string): Promise<boolean> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(oracle)) return false;
  const parsed = AttestationWire.safeParse(c.raw_json);
  if (!parsed.success) return false;
  const w = parsed.data;
  const consistent =
    w.merchant.toLowerCase() === merchantAddress.toLowerCase() &&
    attestationKindFromCode(w.kind) === c.kind &&
    w.caseRef.toLowerCase() === c.case_ref_hash.toLowerCase() &&
    w.issuedAt * 1000 === new Date(c.issued_at).getTime() &&
    w.expiresAt * 1000 === new Date(c.expires_at).getTime() &&
    w.signature === c.signature;
  if (!consistent) return false;
  const signer = await recoverAttestationSigner(w, attestationDomainFromEnv());
  return !!signer && signer.toLowerCase() === oracle.toLowerCase();
}

async function prepaidFacts(tx: PoolClient, snap: GateSnapshot, action: ActionRow, phaseA: PhaseAFacts, ctx: UserCtx, policy: Policy | null) {
  const userId = action.user_id;
  const planId = str(action.args_json.plan_id);
  const wallet = await tx.query("select address from public.wallets where user_id = $1 and kind = 'consumer_browser'", [userId]);
  const facts: PrepaidFacts = { actor: action.actor, ownerWallet: wallet.rows[0]?.address ?? null, plan: null };
  facts.consumerSigValid = false;

  const row = /^[0-9a-f-]{36}$/i.test(planId)
    ? (
        await tx.query(
          `select p.chain_plan_id::text as chain_plan_id, p.merchant_id, m.chain_address
             from public.prepaid_plans p join public.prepaid_merchants m on m.id = p.merchant_id
            where p.id = $1 and p.user_id = $2`,
          [planId, userId],
        )
      ).rows[0]
    : undefined;

  // Plan state must come from the chain (here: the mock escrow), cross-checked with the index row.
  const chain = phaseA.escrowPlan;
  if (row && chain && chain.chainPlanId === row.chain_plan_id && chain.merchant.toLowerCase() === String(row.chain_address).toLowerCase()) {
    facts.plan = {
      owner: chain.owner,
      merchant: chain.merchant,
      agent: chain.agent,
      status: chain.status,
      unitPrice: chain.unitPrice / 100, // fen -> base units
      unitsLeft: chain.unitsTotal - chain.unitsRedeemed,
      nextSession: chain.unitsRedeemed + 1,
    };
    const agentAddr = process.env.AGENT_ADDRESS ?? "";
    facts.agentIsOurs = !!agentAddr && !!chain.agent && chain.agent.toLowerCase() === agentAddr.toLowerCase();

    if (action.tool === "prepaid_exit") {
      // Candidates: this merchant, a kind the mandate auto-exits on, unexpired and within the
      // mandate's max age, newest first. sig_valid only narrows the search; the signature is
      // re-verified below and only a verified record can be chosen.
      const kinds = policy?.prepaid.auto_exit_on ?? [];
      const maxAgeDays = policy?.prepaid.attestation_max_age_days ?? 0;
      const att = await tx.query<AttestationCandidate>(
        `select id, kind, case_ref_hash, issued_at, expires_at, signature, raw_json from public.attestations
          where merchant_id = $1 and kind = any($2::text[]) and sig_valid
            and expires_at > $3::timestamptz and issued_at <= $3::timestamptz
            and issued_at >= $3::timestamptz - make_interval(days => $4::int)
          order by issued_at desc, id limit 10`,
        [row.merchant_id, kinds, ctx.now, maxAgeDays],
      );
      const oracle = process.env.ORACLE_ADDRESS ?? "";
      let chosen: AttestationCandidate | null = null;
      for (const c of att.rows) {
        if (await attestationVerifies(c, String(row.chain_address), oracle)) {
          chosen = c;
          break;
        }
      }
      facts.attestation = chosen
        ? {
            id: chosen.id,
            signerIsOracle: true,
            kind: chosen.kind,
            merchantMatches: true, // checked against the merchant's chain address above
            ageDays: (Date.parse(ctx.now) - new Date(chosen.issued_at).getTime()) / DAY_MS,
            expired: new Date(chosen.expires_at).getTime() <= Date.parse(ctx.now),
          }
        : null;
      // The owner's stored VoluntaryExit signature, recovered against the escrow plan's owner
      // for this chain plan id and unexpired now (never taken from the action args).
      facts.consumerSigValid =
        (await verifiedVoluntaryExitSignature(tx, action.id, {
          chainPlanId: row.chain_plan_id,
          owner: chain.owner,
          nowSeconds: Math.floor(Date.parse(ctx.now) / 1000),
        })) !== null;
    }
  }
  facts.merchantSigValid = false;
  // User-signed actions: the signed payload stored next to the action (never the args), re-verified
  // here against the escrow plan read in phase A. Anything missing or wrong stays false -> deny.
  if (facts.plan && chain && row && (action.tool === "prepaid_redeem" || action.tool === "prepaid_exit_voluntary")) {
    const payload = await signedPayload(tx, action);
    const nowSeconds = Math.floor(Date.parse(ctx.now) / 1000);
    if (action.tool === "prepaid_redeem" && payload) {
      const r = await verifyRedeemSignatures(
        escrowDomainFromEnv(),
        {
          redeem: { planId: row.chain_plan_id, sessionNo: Number(payload.sessionNo), deadline: Number(payload.deadline) },
          consumerSig: str(payload.consumerSig),
          merchantSig: str(payload.merchantSig),
        },
        { chainPlanId: row.chain_plan_id, sessionNo: facts.plan.nextSession, owner: chain.owner, merchant: chain.merchant, nowSeconds },
      );
      facts.consumerSigValid = r.consumerSigValid;
      facts.merchantSigValid = r.merchantSigValid;
      facts.sessionNo = Number(payload.sessionNo);
    }
    if (action.tool === "prepaid_exit_voluntary" && payload) {
      const sig = { deadline: Number(payload.deadline), consumerSig: str(payload.consumerSig) };
      const signer = Number.isSafeInteger(sig.deadline) && sig.deadline > nowSeconds ? await recoverVoluntaryExitSigner(row.chain_plan_id, sig) : null;
      facts.consumerSigValid = !!signer && signer.toLowerCase() === chain.owner.toLowerCase();
    }
  }
  snap.prepaid = facts;
}

/** Chain plan id for a prepaid action's plan, for the phase A read. */
/** The signed payload the user submitted for this action (prepaid_action_signatures), or null. */
async function signedPayload(tx: PoolClient, action: ActionRow): Promise<Record<string, unknown> | null> {
  const r = await tx.query("select payload from public.prepaid_action_signatures where action_id = $1 and user_id = $2 and tool = $3", [
    action.id,
    action.user_id,
    action.tool,
  ]);
  const p = r.rows[0]?.payload;
  return p && typeof p === "object" ? (p as Record<string, unknown>) : null;
}

/**
 * prepaid_purchase: the offer row (by id) gives the stored terms and merchant; the browser's signed
 * payload must match them. The wallet is the user's registered consumer address; the agent named
 * in PurchaseAuth must be ours (AGENT_ADDRESS), so the plan can be exited by Reins on a notice.
 */
async function purchaseFacts(tx: PoolClient, snap: GateSnapshot, action: ActionRow, ctx: UserCtx) {
  const userId = action.user_id;
  const wallet = await tx.query("select address from public.wallets where user_id = $1 and kind = 'consumer_browser'", [userId]);
  const facts: PrepaidFacts = { actor: action.actor, ownerWallet: wallet.rows[0]?.address ?? null, plan: null, consumerSigValid: false };
  snap.prepaid = facts;
  const offerId = str(action.args_json.offer_id);
  if (!/^[0-9a-f-]{36}$/i.test(offerId)) return;
  const o = (
    await tx.query(
      `select o.unit_price::text as unit_price, o.units, o.cancel_fee_bps,
              o.offer_json, m.chain_address, m.escrow_supported
         from public.prepaid_offers o join public.prepaid_merchants m on m.id = o.merchant_id
        where o.id = $1`,
      [offerId],
    )
  ).rows[0];
  if (!o) return;
  const payload = await signedPayload(tx, action);
  const total = (Number(o.unit_price) * Number(o.units)) / 100; // fen -> base units
  const offerRow: PrepaidFacts["offer"] = { merchantSigValid: false, expired: true, termsMatchStored: false, escrowSupported: o.escrow_supported, totalBase: total };
  facts.offer = offerRow;
  if (!payload || !facts.ownerWallet) return;
  const signed = payload.offer as OfferJson | undefined;
  // Stored terms: the price, size and fee from the offer row; merchant from the merchant row. The
  // expiry and nonce are what the merchant signed (the sim re-issues offers), so they come from the
  // signed offer; expiry is checked against now by purchaseSignatureFacts.
  if (!signed || typeof signed !== "object") return;
  const stored: OfferJson = {
    merchant: String(o.chain_address),
    unitPrice: Number(o.unit_price),
    units: Number(o.units),
    cancelFeeBps: Number(o.cancel_fee_bps),
    expiresAt: Number(signed.expiresAt),
    nonce: String(signed.nonce),
  };
  const f = await purchaseSignatureFacts(
    escrowDomainFromEnv(),
    { offer: signed, merchantSig: str(payload.merchantSig), auth: payload.auth as PurchaseAuthJson, consumerSig: str(payload.consumerSig) },
    { owner: facts.ownerWallet, merchant: String(o.chain_address), agent: process.env.AGENT_ADDRESS || null, storedOffer: stored, nowSeconds: Math.floor(Date.parse(ctx.now) / 1000) },
  );
  facts.offer = { ...offerRow, merchantSigValid: f.merchantSigValid, expired: f.expired, termsMatchStored: f.termsMatchStored };
  facts.consumerSigValid = f.consumerSigValid;
}

export async function prepaidChainPlanId(tx: PoolClient, action: ActionRow): Promise<string | null> {
  const planId = str(action.args_json.plan_id);
  if (!/^[0-9a-f-]{36}$/i.test(planId)) return null;
  const r = await tx.query("select chain_plan_id::text as id from public.prepaid_plans where id = $1 and user_id = $2", [planId, action.user_id]);
  return r.rows[0]?.id ?? null;
}
