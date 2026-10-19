// Mandate DSL v1 as zod (PRD §9.2, §9.4). Two shapes:
// - PolicyDraft: what the compiler LLM may return. Every field optional, every object strict,
//   so unknown fields are rejected. base_currency and version are not in it: they come from the
//   account and from activation, not from the model.
// - Policy: the complete policy after `withDefaults`, where every missing field takes its most
//   restrictive value (deny/confirm, caps of 0, autonomous permissions off).
// TODO(R2): move to src/core/mandate/schema.ts (pure) when the mandate core lands.

import { z } from "zod";

const int = z.number().int().min(0);
const Act = z.enum(["deny", "confirm"]);
const AttestationKind = z.enum(["court_enforcement", "closure_notice"]);
const PayeeId = z.string().regex(/^[A-Z0-9_]{2,64}$/);

export const PolicyDraft = z
  .object({
    fx: z.object({ rate_source: z.literal("ecb_reference").optional(), margin_pct: z.number().min(0).max(10).optional() }).strict().optional(),
    payees: z.object({ allow: z.array(PayeeId).max(100).optional(), new_payee: Act.optional() }).strict().optional(),
    bills: z
      .object({
        auto_pay_max: int.optional(),
        anomaly: z
          .object({
            method: z.enum(["median_mad", "conformal"]).optional(),
            k: z.number().min(0).max(10).optional(),
            alpha: z.number().gt(0).lt(1).optional(),
            min_history: int.max(1000).optional(),
          })
          .strict()
          .optional(),
        pay_days_before_due: int.max(31).optional(),
      })
      .strict()
      .optional(),
    subscriptions: z
      .object({
        cancel: Act.optional(),
        subscribe: Act.optional(),
        renewal_notice_days: int.max(60).optional(),
        renew_unseen_price_increase: z.enum(["confirm", "allow"]).optional(),
        auto_cancel_trials: z
          .object({ enabled: z.boolean().optional(), days_before_charge: int.max(30).optional(), notify_days_before: int.max(30).optional() })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    savings_sweep: z
      .object({
        enabled: z.boolean().optional(),
        on: z.string().regex(/^payday\+\d{1,2}$/).optional(),
        pct: z.number().min(0).max(100).optional(),
        keep_buffer_for_bills: z.boolean().optional(),
        undo_hours: int.max(168).optional(),
      })
      .strict()
      .optional(),
    budgets: z.object({ move_between_categories: Act.optional() }).strict().optional(),
    prepaid: z
      .object({
        purchase: Act.optional(),
        escrow_only: z.boolean().optional(),
        max_prepay: int.optional(),
        auto_exit_on: z.array(AttestationKind).max(2).optional(),
        attestation_max_age_days: int.max(365).optional(),
        warn_on_soft_signals: z.boolean().optional(),
      })
      .strict()
      .optional(),
    global: z
      .object({
        daily_outflow_cap: int.optional(),
        // A list rather than a map so the structured-output schema stays closed.
        per_payee_daily_cap: z.array(z.object({ biller_id: PayeeId, cap: int }).strict()).max(100).optional(),
        expires_at: z.iso.datetime({ offset: true }).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type PolicyDraft = z.infer<typeof PolicyDraft>;

export type BaseCurrency = "IDR" | "CNY";

export type Policy = {
  base_currency: BaseCurrency;
  fx: { rate_source: "ecb_reference"; margin_pct: number };
  payees: { allow: string[]; new_payee: "deny" | "confirm" };
  bills: {
    auto_pay_max: number;
    // alpha is optional, as in the core schema (0 < alpha < 1). Without it the conformal check
    // fails closed in the Gate (decide.ts), so leaving it out is the restrictive default.
    anomaly: { method: "median_mad" | "conformal"; k: number; alpha?: number; min_history: number };
    pay_days_before_due: number;
  };
  subscriptions: {
    cancel: "deny" | "confirm";
    subscribe: "deny" | "confirm";
    renewal_notice_days: number;
    renew_unseen_price_increase: "confirm" | "allow";
    auto_cancel_trials: { enabled: boolean; days_before_charge: number; notify_days_before: number };
  };
  savings_sweep?: { enabled: boolean; on: string; pct: number; keep_buffer_for_bills: boolean; undo_hours: number };
  budgets?: { move_between_categories: "deny" | "confirm" };
  prepaid: {
    purchase: "deny" | "confirm";
    escrow_only: boolean;
    max_prepay: number;
    auto_exit_on: ("court_enforcement" | "closure_notice")[];
    attestation_max_age_days: number;
    warn_on_soft_signals: boolean;
  };
  global: { daily_outflow_cap: number; per_payee_daily_cap?: Record<string, number>; expires_at?: string };
};

/**
 * Fills every missing field with its most restrictive value (PRD §9.4) and reports which
 * fields were defaulted, so the read-back can show them.
 */
export function withDefaults(d: PolicyDraft, baseCurrency: BaseCurrency): { policy: Policy; defaulted: string[] } {
  const defaulted: string[] = [];
  const pick = <T>(path: string, v: T | undefined, fallback: T): T => {
    if (v === undefined) {
      defaulted.push(path);
      return fallback;
    }
    return v;
  };

  const policy: Policy = {
    base_currency: baseCurrency,
    fx: { rate_source: "ecb_reference", margin_pct: pick("fx.margin_pct", d.fx?.margin_pct, 10) },
    payees: {
      allow: pick("payees.allow", d.payees?.allow, []),
      new_payee: pick("payees.new_payee", d.payees?.new_payee, "deny"),
    },
    bills: {
      auto_pay_max: pick("bills.auto_pay_max", d.bills?.auto_pay_max, 0),
      anomaly: {
        method: pick("bills.anomaly.method", d.bills?.anomaly?.method, "median_mad"),
        k: pick("bills.anomaly.k", d.bills?.anomaly?.k, 0),
        ...(d.bills?.anomaly?.alpha !== undefined ? { alpha: d.bills.anomaly.alpha } : {}),
        min_history: pick("bills.anomaly.min_history", d.bills?.anomaly?.min_history, 1000),
      },
      pay_days_before_due: pick("bills.pay_days_before_due", d.bills?.pay_days_before_due, 0),
    },
    subscriptions: {
      cancel: pick("subscriptions.cancel", d.subscriptions?.cancel, "deny"),
      subscribe: pick("subscriptions.subscribe", d.subscriptions?.subscribe, "deny"),
      renewal_notice_days: pick("subscriptions.renewal_notice_days", d.subscriptions?.renewal_notice_days, 7),
      renew_unseen_price_increase: pick("subscriptions.renew_unseen_price_increase", d.subscriptions?.renew_unseen_price_increase, "confirm"),
      auto_cancel_trials: {
        enabled: pick("subscriptions.auto_cancel_trials.enabled", d.subscriptions?.auto_cancel_trials?.enabled, false),
        days_before_charge: pick("subscriptions.auto_cancel_trials.days_before_charge", d.subscriptions?.auto_cancel_trials?.days_before_charge, 1),
        notify_days_before: pick("subscriptions.auto_cancel_trials.notify_days_before", d.subscriptions?.auto_cancel_trials?.notify_days_before, 3),
      },
    },
    prepaid: {
      purchase: pick("prepaid.purchase", d.prepaid?.purchase, "deny"),
      escrow_only: pick("prepaid.escrow_only", d.prepaid?.escrow_only, true),
      max_prepay: pick("prepaid.max_prepay", d.prepaid?.max_prepay, 0),
      auto_exit_on: pick("prepaid.auto_exit_on", d.prepaid?.auto_exit_on, []),
      attestation_max_age_days: pick("prepaid.attestation_max_age_days", d.prepaid?.attestation_max_age_days, 0),
      warn_on_soft_signals: pick("prepaid.warn_on_soft_signals", d.prepaid?.warn_on_soft_signals, true),
    },
    global: { daily_outflow_cap: pick("global.daily_outflow_cap", d.global?.daily_outflow_cap, 0) },
  };

  if (d.savings_sweep) {
    const s = d.savings_sweep;
    policy.savings_sweep = {
      enabled: pick("savings_sweep.enabled", s.enabled, false),
      on: pick("savings_sweep.on", s.on, "payday+1"),
      pct: pick("savings_sweep.pct", s.pct, 0),
      keep_buffer_for_bills: pick("savings_sweep.keep_buffer_for_bills", s.keep_buffer_for_bills, true),
      undo_hours: pick("savings_sweep.undo_hours", s.undo_hours, 24),
    };
  }
  if (d.budgets) {
    policy.budgets = { move_between_categories: pick("budgets.move_between_categories", d.budgets.move_between_categories, "deny") };
  }
  if (d.global?.per_payee_daily_cap?.length) {
    policy.global.per_payee_daily_cap = Object.fromEntries(d.global.per_payee_daily_cap.map((c) => [c.biller_id, c.cap]));
  }
  if (d.global?.expires_at) policy.global.expires_at = d.global.expires_at;
  return { policy, defaulted };
}
