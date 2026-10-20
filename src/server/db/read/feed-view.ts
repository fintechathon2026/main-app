// Owner: R2 (roles.md). Activity feed and "Why?" trace for GET /api/feed and /api/feed/:id/why
// (architecture §13, §15.2). Pure: builds items from stored `actions` rows plus registry names.
// Titles, details and Rule check sentences are templates keyed by tool, status, stored rule ids
// and the Gate's own trace; nothing from an LLM and nothing from untrusted text reaches a
// sentence (G2, G6). The trace is the stored `gate_json.trace`, never recomputed here.

import { z } from "zod";
import type { Origin } from "@/src/core/types";
import type { FeedCheck, FeedItem, FeedWhyResponse, Money, UiStatus } from "../../api-types";
import { toolLabel } from "./audit-view";
import { txLink } from "./db";

/** One `actions` row that reached a decision, with names looked up by id. */
export type FeedActionRow = {
  id: string;
  tool: string;
  status: string;
  decision: string | null;
  ruleIds: string[];
  mandateVersion: number;
  args: Record<string, unknown>;
  gate: unknown;
  result: unknown;
  /** ISO time the action ran, or was created if it never ran. */
  at: string;
  baseCurrency: string;
  /** `amount` is the bill row's amount (whole base units); the action's args are never a source for numbers. */
  bill: { billerName: string | null; amount: number; currency: string; dueDate: string; amountOrigin: Origin } | null;
  subscription: { merchantName: string; amount: number; currency: string } | null;
  prepaid: { merchantName: string; unitPriceFen: number; unitsTotal: number; unitsRedeemed: number } | null;
};

/** `actions.status` values the feed shows, and what they look like on screen. */
export const FEED_ACTION_STATUSES = ["succeeded", "awaiting_approval", "denied", "rejected", "expired", "failed", "unknown"] as const;
const UI_STATUS: Record<string, UiStatus> = {
  succeeded: "done",
  awaiting_approval: "ask",
  denied: "blocked",
  rejected: "blocked",
  expired: "blocked",
  failed: "blocked",
  unknown: "blocked",
};

// ---- Rule check sentences ------------------------------------------------------------------

/** A step that passed, by rule id. */
const PASSED: Record<string, string> = {
  "global.kill_switch": "Reins is not paused",
  "approval.valid": "You approved this exact action",
  "provenance.destination": "The payee comes from your saved payees",
  "provenance.amount_mismatch": "The amount matches the bill",
  "provenance.amount": "The amount comes from a trusted source",
  "provenance.subscription": "The subscription is yours",
  "provenance.prepaid_plan": "The package is yours",
  "fx.rate_fresh": "The exchange rate is recent",
  "payees.allow": "The payee is one of your saved payees",
  "bills.auto_pay_max": "The amount is within your auto-pay limit",
  "global.daily_outflow_cap": "Today's total stays under your daily limit",
  "global.per_payee_daily_cap": "Today's total for this payee stays under its limit",
  "subscriptions.auto_cancel_trials": "Free trials are cancelled before the first charge",
  "prepaid.offer_valid": "The offer is valid",
  "prepaid.purchase": "You asked to buy this package",
  "prepaid.escrow_only": "The money is held safely until you use it",
  "prepaid.max_prepay": "The total is within your prepaid limit",
  "prepaid.redeem": "You and the gym both signed this session",
  "prepaid.exit_plan": "You own this active package",
  "prepaid.auto_exit_on": "An official notice allows leaving this package",
  "prepaid.exit_voluntary": "You signed to leave this package",
};

/** A step that did not pass, by the Gate's reason key (falls back to the rule id). */
const FAILED: Record<string, string> = {
  "global.kill_switch.on": "Everything is paused",
  "global.kill_switch": "Everything is paused",
  "prepaid.agent_cannot_purchase": "Only you can buy a package",
  "schema.invalid_args": "The request was not valid",
  "schema.wrong_actor": "The request came from the wrong side",
  "approval.missing": "This needs your OK first",
  "mandate.missing": "No signed rules were found",
  "mandate.signature_invalid": "Your signed rules did not verify",
  "mandate.schema_invalid": "Your signed rules could not be read",
  "mandate.version_mismatch": "Your rules changed since this was checked",
  "mandate.expired": "Your rules have expired",
  "provenance.destination_not_registry": "The account is not in your saved payees",
  "provenance.amount_mismatch": "The amount does not match the bill",
  "provenance.amount_untrusted_origin": "The amount came from a document or email, so you need to confirm it",
  "fx.rate_stale_or_unknown": "The exchange rate is too old",
  "payees.not_allowed": "The payee is not in your saved payees",
  "bills.over_auto_pay_max": "The amount is over your auto-pay limit",
  "global.daily_outflow_cap.exceeded": "This would go over your daily limit",
  "global.per_payee_daily_cap.exceeded": "This would go over the daily limit for this payee",
  "subscriptions.not_found": "The subscription was not found",
  "subscriptions.already_cancelled": "The subscription is already cancelled",
  "subscriptions.cancel_denied": "Your rules do not allow cancelling",
  "subscriptions.cancel_needs_confirm": "Cancelling a subscription needs your OK",
  "prepaid.offer_missing": "The offer was not found",
  "prepaid.purchase_not_authorized": "Only you can buy a package",
  "prepaid.offer_invalid": "The offer is not valid",
  "prepaid.escrow_required": "Paying ahead needs the money held safely",
  "prepaid.over_max_prepay": "This is over your prepaid limit",
  "prepaid.plan_unknown": "The package was not found",
  "prepaid.redeem_invalid": "The session could not be confirmed",
  "prepaid.plan_not_owned_or_inactive": "The package is not yours or is no longer active",
  "prepaid.agent_not_ours": "The package is not set up for Reins to act on",
  "prepaid.exit_needs_confirm": "Leaving a package needs your OK",
  "prepaid.exit_use_voluntary_flow": "Leaving without an official notice needs your signature",
  "prepaid.exit_voluntary_invalid": "The signature to leave could not be confirmed",
};

const TraceStep = z.object({ ruleId: z.string(), result: z.enum(["allow", "require_confirm", "deny"]), reason: z.string().optional() });
const GateJson = z.object({
  decision: z.enum(["allow", "require_confirm", "deny"]),
  mandateHash: z.string().optional(),
  trace: z.array(TraceStep),
});

type Gate = z.infer<typeof GateJson>;
const parseGate = (g: unknown): Gate | null => {
  const p = GateJson.safeParse(g);
  return p.success ? p.data : null;
};

/** Plain-words Rule check, in the order the Gate ran the steps. Quiet steps (schema) are hidden. */
export function checksFromTrace(gate: unknown, mandateVersion: number): FeedCheck[] {
  const g = parseGate(gate);
  if (!g) return [];
  const out: FeedCheck[] = [];
  for (const s of g.trace) {
    const passed = s.result === "allow";
    if (passed && s.ruleId.startsWith("schema.")) continue;
    if (s.ruleId === "mandate.valid" && passed) {
      out.push({ label: `Your rules are signed and current (version ${mandateVersion})`, passed });
      continue;
    }
    const approvalReason = s.reason?.startsWith("approval.") ? "approval.missing" : s.reason;
    const label = passed ? PASSED[s.ruleId] : (FAILED[approvalReason ?? ""] ?? FAILED[s.ruleId] ?? `Did not pass: ${s.reason ?? s.ruleId}`);
    out.push({ label: label ?? `Passed: ${s.ruleId}`, passed });
  }
  return out;
}

// ---- Items ---------------------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayMonth = (ymd: string) => `${Number(ymd.slice(8, 10))} ${MONTHS[Number(ymd.slice(5, 7)) - 1] ?? ""}`.trim();

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function amountOf(r: FeedActionRow): Money | undefined {
  // The amount shown is the bill row's (G6): args_json is model-written and only a lookup key.
  if (r.tool === "pay_bill" && r.bill) return { amount: r.bill.amount, currency: r.bill.currency };
  if (r.tool === "cancel_subscription" && r.subscription) return { amount: r.subscription.amount, currency: r.subscription.currency };
  if (r.tool.startsWith("prepaid_") && r.prepaid) {
    const p = r.prepaid;
    const units = r.tool === "prepaid_redeem" ? 1 : p.unitsTotal - p.unitsRedeemed; // exit: money left in escrow
    return { amount: (p.unitPriceFen * units) / 100, currency: r.baseCurrency };
  }
  return undefined;
}

function nameOf(r: FeedActionRow): string | null {
  return r.bill?.billerName ?? r.subscription?.merchantName ?? r.prepaid?.merchantName ?? null;
}

function titleOf(r: FeedActionRow, status: string): string {
  const name = nameOf(r);
  switch (r.tool) {
    case "pay_bill":
      if (status === "succeeded") return `${name ?? "Bill"} paid`;
      if (status === "awaiting_approval") return `Pay ${name ?? "this bill"}?`;
      if (!name) return "Payment to a new account";
      return `Payment to ${name} ${status === "denied" ? "blocked" : "not made"}`;
    case "cancel_subscription":
      if (status === "succeeded") return `${name ?? "Subscription"} cancelled`;
      if (status === "awaiting_approval") return `Cancel ${name ?? "this subscription"}?`;
      return `Cancelling ${name ?? "a subscription"} did not happen`;
    case "prepaid_exit":
    case "prepaid_exit_voluntary":
      if (status === "succeeded") return `Left ${name ?? "a"} package`;
      if (status === "awaiting_approval") return `Leave ${name ?? "this"} package?`;
      return `Leaving ${name ?? "a"} package did not happen`;
    case "prepaid_redeem":
      return status === "succeeded" ? `${name ?? "Package"} session used` : `${name ?? "Package"} session not used`;
    case "prepaid_purchase":
      return status === "succeeded" ? `Bought a ${name ?? ""} package`.replace("  ", " ") : status === "awaiting_approval" ? "Buy a package?" : "Package purchase did not happen";
    default:
      return cap(toolLabel(r.tool));
  }
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const NOTHING_CHANGED = (tool: string) => (tool === "pay_bill" || tool === "prepaid_purchase" ? "Nothing was paid." : "Nothing was changed.");

function detailOf(r: FeedActionRow, status: string, checks: FeedCheck[]): string {
  const firstMiss = checks.find((c) => !c.passed)?.label;
  switch (status) {
    case "succeeded":
      if (r.tool === "pay_bill") return r.bill ? `Paid for the bill due ${dayMonth(r.bill.dueDate)}.` : "Paid.";
      if (r.tool === "cancel_subscription") return "The subscription was cancelled.";
      if (r.tool === "prepaid_redeem") return "One session was released to the business after you and the business both signed.";
      if (r.tool === "prepaid_exit" || r.tool === "prepaid_exit_voluntary") return "Your unused money went back to you.";
      return "Done.";
    case "awaiting_approval":
      if (!firstMiss) return "It waits for your OK.";
      return /your OK$/.test(firstMiss) ? `${firstMiss}.` : `${firstMiss}, so it waits for your OK.`;
    case "rejected":
      return `You declined this. ${NOTHING_CHANGED(r.tool)}`;
    case "expired":
      return `Your OK did not arrive in time. ${NOTHING_CHANGED(r.tool)}`;
    case "failed":
      return "This did not go through.";
    case "unknown":
      return "Reins could not confirm whether this went through.";
    default:
      return firstMiss ? `${NOTHING_CHANGED(r.tool)} ${firstMiss}.` : NOTHING_CHANGED(r.tool);
  }
}

/** Bill amounts from outside sources are labelled as such (G2); bank-sourced ones show the due date. */
const BILL_ORIGIN_NOTE: Partial<Record<Origin, string>> = {
  document: "Document: bill amount (not trusted for payments)",
  email: "Email: bill amount (not trusted for payments)",
  csv: "Imported file: bill amount (not trusted for payments)",
  user: "You: bill amount",
};

function originsOf(r: FeedActionRow, simulated: boolean): FeedItem["origins"] {
  const out: FeedItem["origins"] = [];
  if (r.tool === "pay_bill" && r.bill) {
    if (r.bill.billerName) out.push({ origin: "registry", label: `Payee: ${r.bill.billerName} (saved payee)` });
    const note = BILL_ORIGIN_NOTE[r.bill.amountOrigin];
    out.push({ origin: r.bill.amountOrigin, label: note ?? `Bill: due ${dayMonth(r.bill.dueDate)}` });
  } else if (r.tool === "cancel_subscription" && r.subscription) {
    out.push({ origin: "mock_bank", label: `Bank: ${r.subscription.merchantName} charge` });
  } else if (r.tool.startsWith("prepaid_")) {
    out.push({ origin: "chain", label: simulated ? "Blockchain: test network (simulated)" : "Blockchain: test network", ...(simulated ? { simulated: true } : {}) });
  }
  return out;
}

function txOf(r: FeedActionRow): { tx?: FeedItem["tx"]; simulated: boolean } {
  const h = rec(r.result).txHash;
  if (typeof h === "string" && h.startsWith("mock:")) return { simulated: true };
  const tx = txLink(h);
  return tx ? { tx, simulated: false } : { simulated: false };
}

export function toFeedItem(r: FeedActionRow): FeedItem | null {
  const status = UI_STATUS[r.status];
  if (!status) return null;
  const checks = checksFromTrace(r.gate, r.mandateVersion);
  const { tx, simulated } = txOf(r);
  const amount = amountOf(r);
  return {
    id: r.id,
    at: r.at,
    status,
    title: titleOf(r, r.status),
    detail: detailOf(r, r.status, checks),
    ...(amount ? { amount } : {}),
    ruleIds: r.ruleIds,
    mandateVersion: r.mandateVersion,
    origins: originsOf(r, simulated),
    checks,
    ...(tx ? { tx } : {}),
  };
}

/** Newest first. Rows in states the feed does not show are skipped. */
export function buildFeed(rows: FeedActionRow[]): FeedItem[] {
  return rows
    .map(toFeedItem)
    .filter((i): i is FeedItem => i !== null)
    .sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
}

export function buildWhy(r: FeedActionRow): FeedWhyResponse | null {
  const status = UI_STATUS[r.status];
  if (!status) return null;
  const g = parseGate(r.gate);
  return {
    id: r.id,
    status,
    decision: g?.decision ?? null,
    mandateVersion: r.mandateVersion,
    mandateHash: g?.mandateHash || null,
    ruleIds: r.ruleIds,
    checks: checksFromTrace(r.gate, r.mandateVersion),
  };
}
