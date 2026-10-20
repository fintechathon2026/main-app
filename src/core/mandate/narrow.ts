// Owner: R2 (roles.md). Mandate narrowing order (PRD §9.5) and equivalence (PRD §9.6). Pure.
//
//   narrows(next, prev)         next gives the agent no more permission than prev
//   compareMandates(prev, next) relation + the changed field paths with a direction each
//   equivalent(p, q)            p and q narrow each other (= equal after normalization)
//
// `next` is the proposed mandate, `prev` the active one. A direction is always read as
// "what the change does to the agent's permission going from prev to next".
//
// Order per field (PRD §9.5): caps <=, sets subset, enums deny <= confirm <= allow, expires_at
// earlier is narrower (absent = unlimited), k <=, alpha >=, min_history >=, auto_cancel_trials
// turning on is widening, fx.margin_pct >=, prepaid.max_prepay <=, escrow_only may not be
// dropped, auto_exit_on subset, attestation_max_age_days <=.
//
// DECISIONS WHERE THE PRD IS SILENT OR UNCLEAR (each is the safe default: WIDENING, or
// "incomparable" which callers must also treat as widening; mixed changes are incomparable and
// architecture §7 says mixed = widening):
//  1. version is ignored. It is assigned by the system, not a permission.
//  2. base_currency: any change is "incomparable". Caps are in base currency, so amounts in
//     different currencies cannot be ordered.
//  3. bills.anomaly.method: any switch (median_mad <-> conformal) is WIDENING in both directions;
//     the two methods' parameters are not on one scale. When the method is equal, k, alpha and
//     min_history are ordered as in the PRD. All three are compared whatever the method, so a
//     median_mad mandate cannot hide a loosened alpha. An absent alpha means "always confirm"
//     (decide.ts) and is treated as the strictest value (+infinity).
//  4. Schedule and notice parameters the PRD gives no order for: bills.pay_days_before_due,
//     subscriptions.renewal_notice_days, auto_cancel_trials.days_before_charge and
//     .notify_days_before, savings_sweep.on / .pct / .keep_buffer_for_bills / .undo_hours,
//     prepaid.warn_on_soft_signals. ANY change is WIDENING.
//  5. savings_sweep and budgets are optional blocks. Absent is narrower than present (even a
//     disabled sweep or a deny budget), so adding a block is widening and removing one is
//     narrowing. Equality is structural (PRD §9.6). The enums inside are ordered as usual.
//  6. global.per_payee_daily_cap is a map of caps. A key in prev and missing in next removes a cap
//     (WIDENING); a key only in next adds one (narrower); shared keys compare as caps. Absent
//     equals the empty map.
//  7. Sets (payees.allow, prepaid.auto_exit_on) compare as sets: order and duplicates are
//     irrelevant. Adding and removing elements in one change is "incomparable" for that field.
//  8. expires_at compares as an instant, so "...Z" and "...+00:00" are the same.
//
// Fields where the PRD's enum or cap rule already gives the order are NOT defaulted to widening:
// payees.new_payee (deny <= confirm), prepaid.purchase (deny <= confirm),
// subscriptions.renew_unseen_price_increase (confirm <= allow), cancel and subscribe
// (deny <= confirm), budgets.move_between_categories (deny <= confirm).
//
// A KNOWN GAP (reported, not fixed here): the PRD's "alpha >= narrows" is not sound against
// decide() for small histories. See the finding in gate.property.test.ts.

import type { Policy } from "./schema";

export type Direction = "narrower" | "wider" | "incomparable";
export type FieldChange = { path: string; direction: Direction };
export type MandateRelation = "narrowing" | "widening" | "equivalent" | "incomparable";
export type MandateComparison = { relation: MandateRelation; changes: FieldChange[] };

type Dir = Direction | null; // null = unchanged

// ---- field comparators (each answers: going prev -> next, what happened?) -----------------

/** Smaller value is narrower (caps, k, max_prepay, attestation age). */
const lowerIsNarrower = (next: number, prev: number): Dir =>
  next === prev ? null : next < prev ? "narrower" : "wider";

/** Larger value is narrower (alpha, min_history, margin_pct). */
const higherIsNarrower = (next: number, prev: number): Dir => lowerIsNarrower(prev, next);

/** Order a closed enum from most restrictive to most permissive. */
function enumDir<T extends string>(order: readonly T[], next: T, prev: T): Dir {
  const n = order.indexOf(next);
  const p = order.indexOf(prev);
  return n === p ? null : n < p ? "narrower" : "wider";
}

/** true = grants the permission (auto_cancel_trials.enabled, savings_sweep.enabled). */
const permissionFlag = (next: boolean, prev: boolean): Dir =>
  next === prev ? null : next ? "wider" : "narrower";

/** true = the restriction is on (escrow_only). Dropping it is widening. */
const restrictionFlag = (next: boolean, prev: boolean): Dir => permissionFlag(prev, next);

/** No order known: any change is widening (the safe default). */
const unordered = <T>(next: T, prev: T): Dir => (next === prev ? null : "wider");

function setDir(next: readonly string[], prev: readonly string[]): Dir {
  const n = new Set(next);
  const p = new Set(prev);
  const added = [...n].some((x) => !p.has(x));
  const removed = [...p].some((x) => !n.has(x));
  if (!added && !removed) return null;
  if (!added) return "narrower";
  if (!removed) return "wider";
  return "incomparable";
}

const CONFIRM_ORDER = ["deny", "confirm"] as const;
const PRICE_ORDER = ["confirm", "allow"] as const;
const instant = (iso: string | undefined): number => (iso === undefined ? Number.POSITIVE_INFINITY : Date.parse(iso));
const alphaOf = (a: number | undefined): number => a ?? Number.POSITIVE_INFINITY;

function diff(prev: Policy, next: Policy): FieldChange[] {
  const out: FieldChange[] = [];
  const add = (path: string, d: Dir) => {
    if (d) out.push({ path, direction: d });
  };

  if (next.base_currency !== prev.base_currency) add("base_currency", "incomparable");
  add("fx.margin_pct", higherIsNarrower(next.fx.margin_pct, prev.fx.margin_pct));

  add("payees.allow", setDir(next.payees.allow, prev.payees.allow));
  add("payees.new_payee", enumDir(CONFIRM_ORDER, next.payees.new_payee, prev.payees.new_payee));

  const nb = next.bills;
  const pb = prev.bills;
  add("bills.auto_pay_max", lowerIsNarrower(nb.auto_pay_max, pb.auto_pay_max));
  add("bills.anomaly.method", unordered(nb.anomaly.method, pb.anomaly.method));
  add("bills.anomaly.k", lowerIsNarrower(nb.anomaly.k, pb.anomaly.k));
  add("bills.anomaly.alpha", higherIsNarrower(alphaOf(nb.anomaly.alpha), alphaOf(pb.anomaly.alpha)));
  add("bills.anomaly.min_history", higherIsNarrower(nb.anomaly.min_history, pb.anomaly.min_history));
  add("bills.pay_days_before_due", unordered(nb.pay_days_before_due, pb.pay_days_before_due));

  const ns = next.subscriptions;
  const ps = prev.subscriptions;
  add("subscriptions.cancel", enumDir(CONFIRM_ORDER, ns.cancel, ps.cancel));
  add("subscriptions.subscribe", enumDir(CONFIRM_ORDER, ns.subscribe, ps.subscribe));
  add("subscriptions.renewal_notice_days", unordered(ns.renewal_notice_days, ps.renewal_notice_days));
  add(
    "subscriptions.renew_unseen_price_increase",
    enumDir(PRICE_ORDER, ns.renew_unseen_price_increase, ps.renew_unseen_price_increase),
  );
  add(
    "subscriptions.auto_cancel_trials.enabled",
    permissionFlag(ns.auto_cancel_trials.enabled, ps.auto_cancel_trials.enabled),
  );
  add(
    "subscriptions.auto_cancel_trials.days_before_charge",
    unordered(ns.auto_cancel_trials.days_before_charge, ps.auto_cancel_trials.days_before_charge),
  );
  add(
    "subscriptions.auto_cancel_trials.notify_days_before",
    unordered(ns.auto_cancel_trials.notify_days_before, ps.auto_cancel_trials.notify_days_before),
  );

  const nw = next.savings_sweep;
  const pw = prev.savings_sweep;
  if (nw && pw) {
    add("savings_sweep.enabled", permissionFlag(nw.enabled, pw.enabled));
    add("savings_sweep.on", unordered(nw.on, pw.on));
    add("savings_sweep.pct", unordered(nw.pct, pw.pct));
    add("savings_sweep.keep_buffer_for_bills", unordered(nw.keep_buffer_for_bills, pw.keep_buffer_for_bills));
    add("savings_sweep.undo_hours", unordered(nw.undo_hours, pw.undo_hours));
  } else if (nw || pw) {
    add("savings_sweep", nw ? "wider" : "narrower");
  }

  const nbud = next.budgets;
  const pbud = prev.budgets;
  if (nbud && pbud) {
    add(
      "budgets.move_between_categories",
      enumDir(CONFIRM_ORDER, nbud.move_between_categories, pbud.move_between_categories),
    );
  } else if (nbud || pbud) {
    add("budgets", nbud ? "wider" : "narrower");
  }

  const np = next.prepaid;
  const pp = prev.prepaid;
  add("prepaid.purchase", enumDir(CONFIRM_ORDER, np.purchase, pp.purchase));
  add("prepaid.escrow_only", restrictionFlag(np.escrow_only, pp.escrow_only));
  add("prepaid.max_prepay", lowerIsNarrower(np.max_prepay, pp.max_prepay));
  add("prepaid.auto_exit_on", setDir(np.auto_exit_on, pp.auto_exit_on));
  add("prepaid.attestation_max_age_days", lowerIsNarrower(np.attestation_max_age_days, pp.attestation_max_age_days));
  add("prepaid.warn_on_soft_signals", unordered(np.warn_on_soft_signals, pp.warn_on_soft_signals));

  add("global.daily_outflow_cap", lowerIsNarrower(next.global.daily_outflow_cap, prev.global.daily_outflow_cap));
  const nCaps = next.global.per_payee_daily_cap ?? {};
  const pCaps = prev.global.per_payee_daily_cap ?? {};
  const keys = [...new Set([...Object.keys(nCaps), ...Object.keys(pCaps)])].sort();
  for (const k of keys) {
    const inNext = Object.hasOwn(nCaps, k);
    const inPrev = Object.hasOwn(pCaps, k);
    const path = `global.per_payee_daily_cap.${k}`;
    if (inNext && inPrev) add(path, lowerIsNarrower(nCaps[k], pCaps[k]));
    else add(path, inNext ? "narrower" : "wider"); // adding a cap narrows; removing one widens
  }
  add("global.expires_at", lowerIsNarrower(instant(next.global.expires_at), instant(prev.global.expires_at)));

  return out;
}

// ---- public API -----------------------------------------------------------------------------

/** True iff `next` grants no more permission than `prev` (reflexive: equal mandates narrow). */
export function narrows(next: Policy, prev: Policy): boolean {
  return diff(prev, next).every((c) => c.direction === "narrower");
}

/**
 * Classify the change from the active mandate `prev` to the proposed `next`.
 * `incomparable` (some fields narrower, some wider or unordered) must be treated as widening by
 * callers that decide how a change is authorized.
 */
export function compareMandates(prev: Policy, next: Policy): MandateComparison {
  const changes = diff(prev, next);
  if (changes.length === 0) return { relation: "equivalent", changes };
  const narrower = changes.filter((c) => c.direction === "narrower").length;
  const wider = changes.filter((c) => c.direction === "wider").length;
  const relation: MandateRelation =
    narrower === changes.length ? "narrowing" : wider === changes.length ? "widening" : "incomparable";
  return { relation, changes };
}

/** p ≡ q iff p ⪯ q and q ⪯ p (PRD §9.6): structural equality after normalization. */
export function equivalent(p: Policy, q: Policy): boolean {
  return diff(p, q).length === 0;
}

/**
 * The form `equivalent` compares: version dropped, sets sorted and de-duplicated, an empty
 * per-payee cap map removed, expires_at as a UTC instant. `equivalent(p, q)` holds exactly when
 * `canonical(comparableForm(p)) === canonical(comparableForm(q))`.
 */
export function comparableForm(p: Policy): unknown {
  const rest: Record<string, unknown> = { ...p };
  delete rest.version;
  const caps = p.global.per_payee_daily_cap ?? {};
  const global: Record<string, unknown> = { daily_outflow_cap: p.global.daily_outflow_cap };
  if (Object.keys(caps).length > 0) global.per_payee_daily_cap = caps;
  if (p.global.expires_at !== undefined) global.expires_at = new Date(Date.parse(p.global.expires_at)).toISOString();
  const sorted = (xs: readonly string[]) => [...new Set(xs)].sort();
  return {
    ...rest,
    payees: { ...p.payees, allow: sorted(p.payees.allow) },
    prepaid: { ...p.prepaid, auto_exit_on: sorted(p.prepaid.auto_exit_on) },
    global,
  };
}
