// Feed copy (architecture §15.3, PRD §18.2): fixed templates keyed by Gate reason keys and tools.
// No model text. Denials say what would make the action allowed. Pure, so it is unit-tested.

export type Tier = "auto" | "approved" | "waiting" | "denied" | "failed" | "info";

export const REASON_TEXT: Record<string, { why: string; fix?: string }> = {
  "global.kill_switch.on": { why: "The kill switch is on.", fix: "Turn the kill switch off in Settings." },
  "mandate.missing": { why: "There is no active mandate.", fix: "Sign a mandate first." },
  "mandate.expired": { why: "Your mandate has expired.", fix: "Sign a new mandate version." },
  "mandate.schema_invalid": { why: "The active mandate could not be read." },
  "mandate.signature_invalid": { why: "The active mandate's hash does not match what you signed." },
  "mandate.version_mismatch": { why: "Your mandate changed after this was planned." },
  "schema.invalid_args": { why: "The proposed action was malformed." },
  "schema.wrong_actor": { why: "Only you can start this kind of action." },
  "provenance.destination_not_registry": {
    why: "The account came from a document, not your payee list.",
    fix: "Add this biller in Payees yourself if it is real.",
  },
  "provenance.amount_untrusted_origin": { why: "The amount came from an untrusted source.", fix: "Approve it after checking the bill." },
  "provenance.amount_mismatch": { why: "The amount does not match the bill on record." },
  "payees.not_allowed": { why: "This payee is not on your allow list.", fix: "Add the payee to your mandate." },
  "bills.over_auto_pay_max": { why: "The amount is above your auto-pay limit.", fix: "Approve it, or raise bills.auto_pay_max." },
  "bills.anomaly": { why: "The amount is unusual for this biller.", fix: "Approve it if the bill is right." },
  "fx.rate_stale_or_unknown": { why: "No fresh exchange rate (older than 2 days).", fix: "Wait for the next FX update." },
  "global.daily_outflow_cap.exceeded": { why: "This would pass your daily spending cap.", fix: "Wait until tomorrow or raise the cap." },
  "global.per_payee_daily_cap.exceeded": { why: "This would pass the daily cap for this payee." },
  "approval.missing": { why: "This needs your approval." },
  "subscriptions.cancel_denied": { why: "Your mandate does not allow cancelling subscriptions.", fix: "Change subscriptions.cancel to confirm." },
  "subscriptions.cancel_needs_confirm": { why: "Cancelling needs your approval." },
  "subscriptions.already_cancelled": { why: "This subscription is already cancelled." },
  "subscriptions.not_found": { why: "The subscription was not found." },
  "prepaid.agent_cannot_purchase": { why: "Reins never buys prepaid packages for you." },
  "prepaid.agent_not_ours": { why: "The escrow plan does not name Reins as its agent." },
  "prepaid.escrow_required": { why: "Your mandate only allows escrow-protected packages." },
  "prepaid.exit_needs_confirm": { why: "Exiting this plan needs your approval." },
  "prepaid.exit_use_voluntary_flow": { why: "There is no signed closure notice.", fix: "Use voluntary exit (fee applies) from the Prepaid screen." },
  "prepaid.exit_voluntary_invalid": { why: "The voluntary exit signature did not verify." },
  "prepaid.offer_invalid": { why: "The offer is not valid." },
  "prepaid.offer_missing": { why: "The offer was not found." },
  "prepaid.over_max_prepay": { why: "The package is above your prepaid limit.", fix: "Raise prepaid.max_prepay." },
  "prepaid.plan_not_owned_or_inactive": { why: "The plan is not yours or is no longer active." },
  "prepaid.plan_unknown": { why: "The plan was not found." },
  "prepaid.purchase_not_authorized": { why: "The purchase signature did not verify." },
  "prepaid.redeem_invalid": { why: "The check-in signatures did not verify." },
};

/** Plain sentence for a rule id (both rule ids and reason keys are looked up). */
export function reasonText(key: string): { why: string; fix?: string } {
  return REASON_TEXT[key] ?? { why: key.replaceAll("_", " ").replaceAll(".", ": ") };
}

const VERB: Record<string, string> = {
  pay_bill: "Pay",
  cancel_subscription: "Cancel",
  prepaid_exit: "Exit plan with",
  prepaid_exit_voluntary: "Exit plan with",
  prepaid_purchase: "Buy package from",
  prepaid_redeem: "Check in at",
  sweep_to_savings: "Move to savings",
};

/** Feed headline, e.g. "Paid State Grid Shenzhen" / "Blocked: pay State Grid Shenzhen". */
export function headline(tool: string, subject: string | null, tier: Tier): string {
  const verb = VERB[tool] ?? tool;
  const what = subject ? `${verb} ${subject}` : verb;
  switch (tier) {
    case "auto":
    case "approved":
      return pastTense(tool, subject);
    case "waiting":
      return `Waiting for you: ${lower(what)}`;
    case "denied":
      return `Blocked: ${lower(what)}`;
    case "failed":
      return `Could not ${lower(what)}`;
    default:
      return what;
  }
}

function pastTense(tool: string, subject: string | null): string {
  const s = subject ?? "";
  switch (tool) {
    case "pay_bill":
      return `Paid ${s}`.trim();
    case "cancel_subscription":
      return `Cancelled ${s}`.trim();
    case "prepaid_exit":
    case "prepaid_exit_voluntary":
      return `Exited plan with ${s}, refund sent to you`.replace("with , ", "");
    case "prepaid_purchase":
      return `Bought package from ${s}`.trim();
    case "prepaid_redeem":
      return `Checked in at ${s}`.trim();
    default:
      return `${VERB[tool] ?? tool} ${s}`.trim();
  }
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Tier from action status + decision (PRD §18.1 #2 badges). */
export function tierOf(status: string, decision: string | null, approved: boolean): Tier {
  if (status === "succeeded") return approved ? "approved" : "auto";
  if (status === "denied") return "denied";
  if (status === "failed" || status === "unknown") return "failed";
  if (status === "awaiting_approval" || decision === "require_confirm") return "waiting";
  if (status === "rejected" || status === "expired" || status === "cancelled_replan") return "info";
  return "info";
}
