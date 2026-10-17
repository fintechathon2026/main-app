// Read-back (architecture §9.1): plain sentences generated from the policy by templates, never
// by an LLM, so what the user signs is exactly what the Gate enforces. Minimal R0 set.
// TODO(R2): move to src/core/mandate/readback.ts with locale support.

import type { Policy } from "./schema";

const amount = (p: Policy, n: number) => `${p.base_currency} ${n.toLocaleString("en-US")}`;
const act = (a: "deny" | "confirm") => (a === "deny" ? "never" : "only with your approval");

export function readback(p: Policy): string[] {
  const lines: string[] = [];
  lines.push(
    p.bills.auto_pay_max > 0
      ? `Pay bills automatically up to ${amount(p, p.bills.auto_pay_max)} each; larger or unusual bills need your approval.`
      : "Never pay a bill automatically; every bill needs your approval.",
  );
  lines.push(
    p.payees.allow.length
      ? `Pay only these payees: ${p.payees.allow.join(", ")}. New payees: ${p.payees.new_payee === "deny" ? "blocked" : "need your approval"}.`
      : `No payees are allowed yet. New payees: ${p.payees.new_payee === "deny" ? "blocked" : "need your approval"}.`,
  );
  lines.push(`Total payments per day stay at or below ${amount(p, p.global.daily_outflow_cap)}.`);
  for (const [id, cap] of Object.entries(p.global.per_payee_daily_cap ?? {})) {
    lines.push(`Payments to ${id} stay at or below ${amount(p, cap)} per day.`);
  }
  lines.push(`Cancel subscriptions: ${act(p.subscriptions.cancel)}. Start subscriptions: ${act(p.subscriptions.subscribe)}.`);
  lines.push(
    p.subscriptions.auto_cancel_trials.enabled
      ? `Cancel free trials automatically ${p.subscriptions.auto_cancel_trials.days_before_charge} day(s) before they charge.`
      : "Never cancel free trials automatically.",
  );
  lines.push(
    `Prepaid packages: buy ${act(p.prepaid.purchase)}, up to ${amount(p, p.prepaid.max_prepay)}` +
      (p.prepaid.escrow_only ? ", escrow only." : "."),
  );
  lines.push(
    p.prepaid.auto_exit_on.length
      ? `Exit a prepaid plan automatically on: ${p.prepaid.auto_exit_on.join(", ")} (attestation at most ${p.prepaid.attestation_max_age_days} day(s) old). Refunds go only to you.`
      : "Never exit a prepaid plan automatically.",
  );
  lines.push(`Foreign amounts are converted at the ECB reference rate plus ${p.fx.margin_pct}% before checking limits.`);
  if (p.global.expires_at) lines.push(`These rules expire at ${p.global.expires_at}.`);
  return lines;
}
