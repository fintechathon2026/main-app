// Owner: R2 (roles.md). Minimal version by R1; extend, don't duplicate.
// Mandate DSL v1 schema (PRD §9.2, §9.4). Pure: no I/O.
// - Unknown fields are rejected (strict objects).
// - Missing fields default to the most restrictive value (deny / confirm / caps of 0).
// Not here yet (R2): narrowing order, equivalence, read-back, diff (architecture §9.2).

import { z } from "zod";

const confirmOrDeny = z.enum(["confirm", "deny"]);
const attestationKind = z.enum(["court_enforcement", "closure_notice"]);
const nonNegInt = z.number().int().nonnegative();

export const policySchema = z
  .object({
    version: z.number().int().positive(),
    base_currency: z.enum(["IDR", "CNY"]),
    fx: z
      .object({
        rate_source: z.literal("ecb_reference"),
        margin_pct: z.number().nonnegative(),
      })
      .strict()
      .default({ rate_source: "ecb_reference", margin_pct: 0 }),
    payees: z
      .object({
        allow: z.array(z.string().min(1)).default([]),
        new_payee: confirmOrDeny.default("deny"),
      })
      .strict()
      .default({ allow: [], new_payee: "deny" }),
    bills: z
      .object({
        auto_pay_max: nonNegInt.default(0),
        anomaly: z
          .object({
            method: z.enum(["median_mad", "conformal"]).default("median_mad"),
            k: z.number().nonnegative().default(0),
            alpha: z.number().gt(0).lt(1).optional(),
            min_history: nonNegInt.default(Number.MAX_SAFE_INTEGER),
          })
          .strict()
          .default({ method: "median_mad", k: 0, min_history: Number.MAX_SAFE_INTEGER }),
        pay_days_before_due: nonNegInt.default(0),
      })
      .strict()
      .default({
        auto_pay_max: 0,
        anomaly: { method: "median_mad", k: 0, min_history: Number.MAX_SAFE_INTEGER },
        pay_days_before_due: 0,
      }),
    subscriptions: z
      .object({
        cancel: confirmOrDeny.default("deny"),
        subscribe: confirmOrDeny.default("deny"),
        renewal_notice_days: nonNegInt.default(0),
        renew_unseen_price_increase: z.enum(["confirm", "allow"]).default("confirm"),
        auto_cancel_trials: z
          .object({
            enabled: z.boolean().default(false),
            days_before_charge: nonNegInt.default(0),
            notify_days_before: nonNegInt.default(0),
          })
          .strict()
          .default({ enabled: false, days_before_charge: 0, notify_days_before: 0 }),
      })
      .strict()
      .default({
        cancel: "deny",
        subscribe: "deny",
        renewal_notice_days: 0,
        renew_unseen_price_increase: "confirm",
        auto_cancel_trials: { enabled: false, days_before_charge: 0, notify_days_before: 0 },
      }),
    savings_sweep: z
      .object({
        enabled: z.boolean(),
        on: z.string().regex(/^payday\+\d+$/),
        pct: z.number().min(0).max(100),
        keep_buffer_for_bills: z.boolean(),
        undo_hours: nonNegInt,
      })
      .strict()
      .optional(),
    budgets: z.object({ move_between_categories: confirmOrDeny }).strict().optional(),
    prepaid: z
      .object({
        purchase: confirmOrDeny.default("deny"),
        escrow_only: z.boolean().default(true),
        max_prepay: nonNegInt.default(0),
        auto_exit_on: z.array(attestationKind).default([]),
        attestation_max_age_days: nonNegInt.default(0),
        warn_on_soft_signals: z.boolean().default(true),
      })
      .strict()
      .default({
        purchase: "deny",
        escrow_only: true,
        max_prepay: 0,
        auto_exit_on: [],
        attestation_max_age_days: 0,
        warn_on_soft_signals: true,
      }),
    global: z
      .object({
        daily_outflow_cap: nonNegInt.default(0),
        per_payee_daily_cap: z.record(z.string(), nonNegInt).optional(),
        expires_at: z.iso.datetime({ offset: true }).optional(),
      })
      .strict()
      .default({ daily_outflow_cap: 0 }),
  })
  .strict();

/** A validated policy with every default applied. */
export type Policy = z.infer<typeof policySchema>;
/** The authoring shape (defaults optional). */
export type PolicyInput = z.input<typeof policySchema>;

export type ParseResult = { ok: true; policy: Policy } | { ok: false; errors: string[] };

export function parsePolicy(input: unknown): ParseResult {
  const r = policySchema.safeParse(input);
  if (r.success) return { ok: true, policy: r.data };
  return {
    ok: false,
    errors: r.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`),
  };
}
