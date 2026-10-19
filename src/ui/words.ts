// System terms -> on-screen words (docs/ui-direction.md §5). Keep UI copy in plain English.

import type { Origin } from "@/src/core/types";

export type Status = "done" | "ask" | "suggest" | "blocked";

export const STATUS_LABEL: Record<Status, string> = {
  done: "Done for you",
  ask: "Needs your OK",
  suggest: "Suggestion",
  blocked: "Blocked",
};

export const ORIGIN_LABEL: Record<Origin, string> = {
  user: "You",
  registry: "Saved payees",
  mock_bank: "Bank",
  aggregator: "Bank link",
  fx_provider: "Exchange rate",
  chain: "Blockchain",
  oracle: "Official notice",
  email: "Email",
  document: "Document",
  notification: "Notification",
  csv: "Imported file",
  web: "Web",
  simulated: "Simulated",
};

/** Plain sentence for a Gate rule id. Unknown ids fall back to the id itself. */
const RULE_TEXT: Record<string, string> = {
  "bills.auto_pay_max": "Bills under your auto-pay limit are paid for you",
  "bills.over_auto_pay_max": "Bills over your auto-pay limit need your OK",
  "bills.anomaly": "Bills that look unusual need your OK",
  "payees.allow": "Money only goes to your saved payees",
  "payees.new_payee": "New payees are not allowed",
  "payees.not_allowed": "This payee is not in your saved payees",
  "subscriptions.cancel": "Cancelling a subscription",
  "subscriptions.cancel_needs_confirm": "Cancelling a subscription needs your OK",
  "subscriptions.cancel_denied": "Your rules do not allow cancelling",
  "subscriptions.auto_cancel_trials": "Free trials are cancelled before the first charge",
  "subscriptions.trial_keep_flag": "You chose to keep this trial",
  "prepaid.auto_exit_on": "Leave a package when there is an official notice",
  "prepaid.exit_needs_confirm": "Leaving a package needs your OK",
  "prepaid.escrow_only": "Prepaid money must be held safely until you use it",
  "prepaid.over_max_prepay": "Over your prepaid limit",
  "prepaid.agent_cannot_purchase": "Only you can buy a package",
  "executor.consumer_signature_invalid": "Leaving this package needs your signature again",
  "global.daily_outflow_cap": "Daily spending limit",
  "global.kill_switch": "Everything is paused",
  "fx.rate_stale_or_unknown": "The exchange rate is too old",
};

export function ruleText(id: string): string {
  return RULE_TEXT[id] ?? id;
}

export const TOOL_LABEL: Record<string, string> = {
  pay_bill: "Pay bill",
  cancel_subscription: "Cancel subscription",
  prepaid_exit: "Leave package",
  prepaid_exit_voluntary: "Leave package",
};

export const CATEGORY_LABEL: Record<string, string> = {
  food_delivery: "Food delivery",
  shopping: "Shopping",
  utilities: "Utilities",
  transport: "Transport",
  entertainment: "Entertainment",
  software: "Software",
  fitness: "Fitness",
  rent: "Rent",
};
