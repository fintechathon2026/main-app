// Owner: R2 (roles.md). Minimal version by R1; extend, don't duplicate.
// PRD §9.3 example mandates. `LIN_MANDATE_V3` is the R0 demo persona's active mandate and is
// the exact policy_json in supabase/seed.sql (its hash is asserted in tests).

import type { PolicyInput } from "./schema";

export const LIN_MANDATE_V3 = {
  version: 3,
  base_currency: "CNY",
  fx: { rate_source: "ecb_reference", margin_pct: 3 },
  payees: { allow: ["SZ_POWER", "CHINA_MOBILE", "LANDLORD_WANG"], new_payee: "deny" },
  bills: {
    auto_pay_max: 300,
    anomaly: { method: "median_mad", k: 3, min_history: 3 },
    pay_days_before_due: 2,
  },
  subscriptions: {
    cancel: "confirm",
    subscribe: "deny",
    renewal_notice_days: 5,
    renew_unseen_price_increase: "confirm",
    auto_cancel_trials: { enabled: true, days_before_charge: 1, notify_days_before: 3 },
  },
  prepaid: {
    purchase: "confirm",
    escrow_only: true,
    max_prepay: 8000,
    auto_exit_on: ["court_enforcement", "closure_notice"],
    attestation_max_age_days: 2,
    warn_on_soft_signals: true,
  },
  global: { daily_outflow_cap: 1000 },
} as const satisfies PolicyInput;
