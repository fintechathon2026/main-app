// Owner: R2 (roles.md). Minimal version by R1; extend, don't duplicate.
// Policy Gate decision function (architecture §7, PRD §10, §24.9). PURE: no I/O, no clock,
// no randomness. Every input comes from `GateSnapshot`, which the executor builds from DB rows
// (provenance is re-derived there, never taken from LLM arguments).
//
// Pipeline (architecture §7.2), most restrictive wins (deny > require_confirm > allow):
//   1 kill switch · 2 mandate · 3 schema · 4 provenance · 5 payees · 6 action-type rules
//   7 amount + FX · 8 anomaly · 9 caps · 10 approval upgrade
// Steps 1–3 short-circuit: nothing after them is meaningful without a valid mandate and args.
//
// Snapshot conventions this function relies on (set by src/server/executor/snapshot.ts):
// - `fx` is non-null exactly when the action amount is in a foreign currency. A foreign amount
//   with no trusted rate is passed as a rate with an epoch date, so `fx.rate_fresh` denies it.
// - `prepaid.plan.unitPrice` is in base-currency units (yuan), not fen.

import { z } from "zod";
import type { Decision, GateResult, GateSnapshot, Origin, RuleTrace, TypedAction } from "../types";
import { parsePolicy, type Policy } from "../mandate/schema";
import { conformalCheck, medianMadCheck, type AnomalyVerdict } from "./anomaly";

const RANK: Record<Decision, number> = { allow: 0, require_confirm: 1, deny: 2 };
const DAY_MS = 86_400_000;
/** PRD §10.3: FX rate must come from fx_provider and be dated within 2 days. */
export const FX_MAX_AGE_DAYS = 2;

/** Origins acceptable as the amount of an auto-pay without extra conditions (PRD §10.3). */
const TRUSTED_AMOUNT_ORIGINS: readonly Origin[] = ["mock_bank", "aggregator"];
/** Origins acceptable for auto-pay only if payee registered, amount ≤ auto_pay_max, anomaly passes. */
const CONDITIONAL_AMOUNT_ORIGINS: readonly Origin[] = ["document", "email"];
/** Trial status origins trusted for T3 auto-cancel ("mock_bank or merchant API"). */
const TRUSTED_TRIAL_ORIGINS: readonly Origin[] = ["mock_bank"];

export const actionArgSchemas = {
  pay_bill: z
    .object({ bill_id: z.string().min(1), biller_id: z.string().min(1), amount: z.number().int().positive() })
    .strict(),
  cancel_subscription: z.object({ subscription_id: z.string().min(1) }).strict(),
  sweep_to_savings: z.object({ amount: z.number().int().positive() }).strict(),
  prepaid_exit: z.object({ plan_id: z.string().min(1) }).strict(),
  prepaid_purchase: z.object({ offer_id: z.string().min(1) }).strict(),
  prepaid_redeem: z.object({ plan_id: z.string().min(1), session_no: z.number().int().positive() }).strict(),
  prepaid_exit_voluntary: z.object({ plan_id: z.string().min(1) }).strict(),
} as const;

/** Which actor may initiate each tool. Agent-initiated purchases are handled by their own rule. */
const TOOL_ACTOR: Record<TypedAction["tool"], "agent" | "user"> = {
  pay_bill: "agent",
  cancel_subscription: "agent",
  sweep_to_savings: "agent",
  prepaid_exit: "agent",
  prepaid_purchase: "user",
  prepaid_redeem: "user",
  prepaid_exit_voluntary: "user",
};

class Trace {
  readonly rules: RuleTrace[] = [];
  readonly reasons: string[] = [];
  add(ruleId: string, result: Decision, reason?: string) {
    this.rules.push(reason ? { ruleId, result, reason } : { ruleId, result });
    if (result !== "allow" && reason) this.reasons.push(reason);
  }
  combined(): Decision {
    return this.rules.reduce<Decision>((acc, r) => (RANK[r.result] > RANK[acc] ? r.result : acc), "allow");
  }
}

function result(t: Trace, snap: GateSnapshot, amountBase: number, override?: Decision): GateResult {
  const decision = override ?? t.combined();
  const ruleIds = t.rules.filter((r) => r.result === decision).map((r) => r.ruleId);
  return {
    decision,
    ruleIds: [...new Set(ruleIds)],
    reasons: [...new Set(t.reasons)],
    mandateVersion: snap.mandate?.version ?? 0,
    mandateHash: snap.mandate?.hash ?? "",
    amountBase,
    trace: t.rules,
  };
}

function ageDays(nowIso: string, thenIso: string): number {
  return (Date.parse(nowIso) - Date.parse(thenIso)) / DAY_MS;
}

const sameAddr = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();

export function decide(action: TypedAction, snap: GateSnapshot): GateResult {
  const t = new Trace();

  // 1. Kill switch
  if (snap.killSwitch) {
    t.add("global.kill_switch", "deny", "global.kill_switch.on");
    return result(t, snap, 0);
  }
  t.add("global.kill_switch", "allow");

  // 2. Mandate valid, signature valid, not expired
  const policy = checkMandate(t, snap);
  if (!policy) return result(t, snap, 0);

  // 3. Schema (and the tool's permitted actor)
  const schema = actionArgSchemas[action.tool as keyof typeof actionArgSchemas];
  if (!schema || !schema.safeParse(action.args).success) {
    t.add(`schema.${String(action.tool)}`, "deny", "schema.invalid_args");
    return result(t, snap, 0);
  }
  if (action.tool === "prepaid_purchase" && action.actor !== "user") {
    // Table §24.9: an agent-initiated purchase is always denied.
    t.add("prepaid.agent_cannot_purchase", "deny", "prepaid.agent_cannot_purchase");
    return result(t, snap, 0);
  }
  if (TOOL_ACTOR[action.tool] !== action.actor) {
    t.add(`schema.${action.tool}`, "deny", "schema.wrong_actor");
    return result(t, snap, 0);
  }
  t.add(`schema.${action.tool}`, "allow");

  let amountBase = 0;
  switch (action.tool) {
    case "pay_bill":
      amountBase = payBill(t, snap, policy, action.args.amount, action.args.biller_id);
      break;
    case "cancel_subscription":
      cancelSubscription(t, snap, policy);
      break;
    case "sweep_to_savings":
      // P1 feature: only with an enabled sweep block, and always confirmed in this minimal version.
      t.add(
        "savings_sweep.enabled",
        policy.savings_sweep?.enabled ? "require_confirm" : "deny",
        policy.savings_sweep?.enabled ? "savings_sweep.confirm" : "savings_sweep.disabled",
      );
      break;
    case "prepaid_purchase":
      prepaidPurchase(t, snap, policy);
      break; // escrow deposits do not count toward daily caps (PRD §9.4)
    case "prepaid_redeem":
      amountBase = prepaidRedeem(t, snap, policy, action.args.session_no);
      break;
    case "prepaid_exit":
      prepaidExit(t, snap, policy);
      break;
    case "prepaid_exit_voluntary":
      prepaidExitVoluntary(t, snap);
      break;
  }

  // 10. Approval upgrade: only require_confirm can be upgraded, and only by a valid approval.
  const combined = t.combined();
  if (combined === "require_confirm") {
    if (snap.approval?.valid) {
      t.add("approval.valid", "allow");
      return result(t, snap, amountBase, "allow");
    }
    t.add("approval.valid", "require_confirm", snap.approval ? `approval.${snap.approval.reason ?? "invalid"}` : "approval.missing");
  }
  return result(t, snap, amountBase);
}

function checkMandate(t: Trace, snap: GateSnapshot): Policy | null {
  if (!snap.mandate) {
    t.add("mandate.valid", "deny", "mandate.missing");
    return null;
  }
  if (!snap.mandate.signatureValid) {
    t.add("mandate.valid", "deny", "mandate.signature_invalid");
    return null;
  }
  const parsed = parsePolicy(snap.mandate.policy);
  if (!parsed.ok) {
    t.add("mandate.valid", "deny", "mandate.schema_invalid");
    return null;
  }
  if (parsed.policy.version !== snap.mandate.version) {
    t.add("mandate.valid", "deny", "mandate.version_mismatch");
    return null;
  }
  const exp = parsed.policy.global.expires_at;
  if (exp && Date.parse(exp) <= Date.parse(snap.now)) {
    t.add("mandate.valid", "deny", "mandate.expired");
    return null;
  }
  t.add("mandate.valid", "allow");
  return parsed.policy;
}

function anomalyVerdict(x: number, history: readonly number[], policy: Policy): AnomalyVerdict {
  const a = policy.bills.anomaly;
  if (a.method === "conformal") {
    if (a.alpha === undefined) return { anomalous: true, reason: "insufficient_history" };
    return conformalCheck(x, history, a.alpha);
  }
  return medianMadCheck(x, history, a.k, a.min_history);
}

function payBill(t: Trace, snap: GateSnapshot, policy: Policy, amount: number, billerId: string): number {
  const p = snap.provenance;

  // 4. Provenance (PRD §10.3)
  if (p.destinationOrigin !== "registry" || !snap.payee || snap.payee.billerId !== billerId) {
    t.add("provenance.destination", "deny", "provenance.destination_not_registry");
  } else {
    t.add("provenance.destination", "allow");
  }
  if (!p.amountMatchesBill) {
    t.add("provenance.amount_mismatch", "deny", "provenance.amount_mismatch");
  } else {
    t.add("provenance.amount_mismatch", "allow");
  }

  // 7 (FX first, so every later check uses the converted amount)
  let amountBase = amount;
  if (snap.fx) {
    const age = ageDays(snap.now, snap.fx.date);
    const fresh = snap.fx.source === "fx_provider" && snap.fx.rate > 0 && age >= 0 && age <= FX_MAX_AGE_DAYS;
    if (!fresh) {
      t.add("fx.rate_fresh", "deny", "fx.rate_stale_or_unknown");
    } else {
      t.add("fx.rate_fresh", "allow");
    }
    amountBase = Math.ceil(amount * snap.fx.rate * (1 + policy.fx.margin_pct / 100));
  }

  // 8. Anomaly (computed once; also used by the conditional-origin provenance rule).
  // History is in the bill's own currency (snapshot), so compare the unconverted amount.
  const anomaly = anomalyVerdict(amount, snap.history.amounts, policy);
  const overAutoPay = amountBase > policy.bills.auto_pay_max;

  // 4 (cont.) amount origin
  const origin = p.amountOrigin;
  if (origin && TRUSTED_AMOUNT_ORIGINS.includes(origin)) {
    t.add("provenance.amount", "allow");
  } else if (origin && CONDITIONAL_AMOUNT_ORIGINS.includes(origin)) {
    const ok = !!snap.payee?.inRegistry && !overAutoPay && !anomaly.anomalous;
    t.add("provenance.amount", ok ? "allow" : "require_confirm", ok ? undefined : "provenance.amount_untrusted_origin");
  } else {
    t.add("provenance.amount", "require_confirm", "provenance.amount_untrusted_origin");
  }

  // 5. Payees
  const inAllow = policy.payees.allow.includes(billerId);
  if (snap.payee?.inRegistry && snap.payee.verified && inAllow) {
    t.add("payees.allow", "allow");
  } else {
    const r: Decision = policy.payees.new_payee === "confirm" ? "require_confirm" : "deny";
    t.add("payees.new_payee", r, "payees.not_allowed");
  }

  // 7. Amount threshold
  t.add("bills.auto_pay_max", overAutoPay ? "require_confirm" : "allow", overAutoPay ? "bills.over_auto_pay_max" : undefined);

  // 8. Anomaly
  t.add(
    "bills.anomaly",
    anomaly.anomalous ? "require_confirm" : "allow",
    anomaly.anomalous ? `bills.anomaly.${anomaly.reason}` : undefined,
  );

  // 9. Caps
  caps(t, snap, policy, amountBase, billerId);
  return amountBase;
}

function caps(t: Trace, snap: GateSnapshot, policy: Policy, amountBase: number, payeeId?: string) {
  const dailyCap = Math.min(snap.caps.dailyCap, policy.global.daily_outflow_cap);
  if (snap.caps.dailyUsed + amountBase > dailyCap) {
    t.add("global.daily_outflow_cap", "deny", "global.daily_outflow_cap.exceeded");
  } else {
    t.add("global.daily_outflow_cap", "allow");
  }
  // Own keys only: `?.[payeeId]` would read inherited members ("constructor", "__proto__"),
  // turn the cap into NaN via Math.min below and silently skip it.
  const capMap = policy.global.per_payee_daily_cap;
  const policyPayeeCap = payeeId && capMap && Object.hasOwn(capMap, payeeId) ? capMap[payeeId] : undefined;
  const payeeCaps = [policyPayeeCap, snap.caps.perPayeeCap].filter((c): c is number => c !== undefined);
  if (payeeCaps.length > 0) {
    const cap = Math.min(...payeeCaps);
    const used = snap.caps.perPayeeUsed ?? 0;
    if (used + amountBase > cap) {
      t.add("global.per_payee_daily_cap", "deny", "global.per_payee_daily_cap.exceeded");
    } else {
      t.add("global.per_payee_daily_cap", "allow");
    }
  }
}

function cancelSubscription(t: Trace, snap: GateSnapshot, policy: Policy) {
  const sub = snap.subscription;
  if (!sub) {
    t.add("provenance.subscription", "deny", "subscriptions.not_found");
    return;
  }
  if (sub.status === "cancelled") {
    t.add("subscriptions.cancel", "deny", "subscriptions.already_cancelled");
    return;
  }
  if (policy.subscriptions.cancel === "deny") {
    t.add("subscriptions.cancel", "deny", "subscriptions.cancel_denied");
    return;
  }
  // T3: trial auto-cancel, only when every condition holds; otherwise one-tap approval.
  const auto = policy.subscriptions.auto_cancel_trials;
  const trustedTrial = sub.trialOrigin !== null && TRUSTED_TRIAL_ORIGINS.includes(sub.trialOrigin);
  if (auto.enabled && sub.isTrial && trustedTrial && !sub.keepFlag && sub.noticeSent) {
    t.add("subscriptions.auto_cancel_trials", "allow");
    return;
  }
  if (auto.enabled && sub.isTrial) {
    const why = !trustedTrial
      ? "subscriptions.trial_origin_untrusted"
      : sub.keepFlag
        ? "subscriptions.trial_keep_flag"
        : "subscriptions.trial_notice_not_sent";
    t.add("subscriptions.auto_cancel_trials", "require_confirm", why);
  }
  t.add("subscriptions.cancel", "require_confirm", "subscriptions.cancel_needs_confirm");
}

function prepaidPurchase(t: Trace, snap: GateSnapshot, policy: Policy) {
  const f = snap.prepaid;
  const offer = f?.offer;
  if (!f || !offer) {
    t.add("prepaid.offer_valid", "deny", "prepaid.offer_missing");
    return;
  }
  const purchaseOk = policy.prepaid.purchase === "confirm" && f.actor === "user" && f.consumerSigValid === true;
  t.add("prepaid.purchase", purchaseOk ? "allow" : "deny", purchaseOk ? undefined : "prepaid.purchase_not_authorized");
  const offerOk = offer.merchantSigValid && !offer.expired && offer.termsMatchStored;
  t.add("prepaid.offer_valid", offerOk ? "allow" : "deny", offerOk ? undefined : "prepaid.offer_invalid");
  const escrowOk = offer.escrowSupported || !policy.prepaid.escrow_only;
  t.add("prepaid.escrow_only", escrowOk ? "allow" : "deny", escrowOk ? undefined : "prepaid.escrow_required");
  const maxOk = offer.totalBase <= policy.prepaid.max_prepay;
  t.add("prepaid.max_prepay", maxOk ? "allow" : "deny", maxOk ? undefined : "prepaid.over_max_prepay");
}

function ownedActivePlan(snap: GateSnapshot) {
  const f = snap.prepaid;
  const plan = f?.plan;
  return {
    f,
    plan,
    ok: !!plan && plan.status === "active" && sameAddr(plan.owner, f?.ownerWallet),
  };
}

function prepaidRedeem(t: Trace, snap: GateSnapshot, policy: Policy, sessionNo: number): number {
  const { f, plan, ok } = ownedActivePlan(snap);
  if (!f || !plan) {
    t.add("provenance.prepaid_plan", "deny", "prepaid.plan_unknown");
    return 0;
  }
  const allOk =
    ok &&
    sessionNo === plan.nextSession &&
    // Fail closed: the signed session number must be present and agree with the argument.
    f.sessionNo !== undefined &&
    f.sessionNo === sessionNo &&
    f.consumerSigValid === true &&
    f.merchantSigValid === true;
  t.add("prepaid.redeem", allOk ? "allow" : "deny", allOk ? undefined : "prepaid.redeem_invalid");
  // Session releases count as outflows (PRD §9.4).
  caps(t, snap, policy, plan.unitPrice);
  return plan.unitPrice;
}

function prepaidExit(t: Trace, snap: GateSnapshot, policy: Policy) {
  const { f, plan, ok } = ownedActivePlan(snap);
  if (!f || !plan) {
    t.add("provenance.prepaid_plan", "deny", "prepaid.plan_unknown");
    return;
  }
  // The plan must be active, owned by the user's wallet, and name our agent; nothing (not even
  // an approval) can make an exit of someone else's or a finished plan acceptable.
  if (!ok) {
    t.add("prepaid.exit_plan", "deny", "prepaid.plan_not_owned_or_inactive");
    return;
  }
  if (f.agentIsOurs !== true) {
    t.add("prepaid.exit_plan", "deny", "prepaid.agent_not_ours");
    return;
  }
  t.add("prepaid.exit_plan", "allow");
  const a = f.attestation;
  const attOk =
    !!a &&
    a.signerIsOracle &&
    a.merchantMatches &&
    !a.expired &&
    a.ageDays >= 0 &&
    a.ageDays <= policy.prepaid.attestation_max_age_days &&
    policy.prepaid.auto_exit_on.includes(a.kind);
  if (attOk) {
    t.add("prepaid.auto_exit_on", "allow");
    return;
  }
  // No valid attestation: the exit is a fee-bearing voluntary exit, which needs the consumer's
  // own signature. With it, one approval may confirm; without it, deny and point the user to the
  // voluntary-exit flow (an approval alone must never move escrowed money).
  if (f.consumerSigValid === true) {
    t.add("prepaid.auto_exit_on", "require_confirm", "prepaid.exit_needs_confirm");
  } else {
    t.add("prepaid.auto_exit_on", "deny", "prepaid.exit_use_voluntary_flow");
  }
}

function prepaidExitVoluntary(t: Trace, snap: GateSnapshot) {
  const { f, plan, ok } = ownedActivePlan(snap);
  if (!f || !plan) {
    t.add("provenance.prepaid_plan", "deny", "prepaid.plan_unknown");
    return;
  }
  const allOk = ok && f.consumerSigValid === true;
  t.add("prepaid.exit_voluntary", allOk ? "allow" : "deny", allOk ? undefined : "prepaid.exit_voluntary_invalid");
}
