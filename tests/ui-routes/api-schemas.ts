// Owner: R2 (roles.md).
// Zod mirror of the R2 response types in src/server/api-types.ts (UI read routes). Objects are
// strict, so a fixture with an extra or misspelled field fails. The `Equal` checks below fail
// `tsc` if the mirror and the TypeScript types drift apart.

import { z } from "zod";
import { policySchema } from "@/src/core/mandate/schema";
import type * as T from "@/src/server/api-types";

export const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
export const hash64 = z.string().regex(/^[0-9a-f]{64}$/);

export const UiStatus = z.enum(["done", "ask", "suggest", "blocked"]);

const TxLink = z.strictObject({ hash: z.string().min(1), explorerUrl: z.string() });
const Money = z.strictObject({ amount: z.number(), currency: z.string().regex(/^[A-Z]{3}$/) });
const Origin = z.enum([
  "user", "registry", "mock_bank", "aggregator", "fx_provider", "chain", "oracle", "email", "document", "notification", "csv", "web", "simulated",
]);
const Decision = z.enum(["allow", "require_confirm", "deny"]);

export const FeedCheck = z.strictObject({ label: z.string().min(1), passed: z.boolean() });
export const FeedItem = z.strictObject({
  id: z.string().min(1),
  at: iso,
  status: UiStatus,
  title: z.string().min(1),
  detail: z.string().min(1),
  amount: Money.optional(),
  ruleIds: z.array(z.string().min(1)),
  mandateVersion: z.number().int().positive(),
  origins: z.array(z.strictObject({ origin: Origin, label: z.string().min(1), simulated: z.boolean().optional() })),
  checks: z.array(FeedCheck),
  tx: TxLink.optional(),
});
export const FeedResponse = z.array(FeedItem);
export const FeedWhyResponse = z.strictObject({
  id: z.string().min(1),
  status: UiStatus,
  decision: Decision.nullable(),
  mandateVersion: z.number().int().positive(),
  mandateHash: hash64.nullable(),
  ruleIds: z.array(z.string().min(1)),
  checks: z.array(FeedCheck),
});

export const MandateActiveResponse = z.strictObject({
  version: z.number().int().positive(),
  hash: hash64,
  signedAt: iso,
  createdVia: z.enum(["nl", "template", "edit"]),
  policy: policySchema,
});
export const MandateVersion = z.strictObject({
  version: z.number().int().positive(),
  signedAt: iso,
  change: z.string().min(1),
  direction: z.enum(["less", "more", "first"]).nullable(),
  status: z.enum(["active", "superseded", "revoked"]),
});
export const MandateHistoryResponse = z.array(MandateVersion);

const act = z.enum(["deny", "confirm"]);
const nat = z.number().int().nonnegative();
/** The compiler's complete draft policy (src/server/mandate/schema.ts `Policy`, no `version`). */
export const DraftPolicy = z.strictObject({
  base_currency: z.enum(["IDR", "CNY"]),
  fx: z.strictObject({ rate_source: z.literal("ecb_reference"), margin_pct: z.number().nonnegative() }),
  payees: z.strictObject({ allow: z.array(z.string().min(1)), new_payee: act }),
  bills: z.strictObject({
    auto_pay_max: nat,
    anomaly: z.strictObject({ method: z.enum(["median_mad", "conformal"]), k: z.number().nonnegative(), alpha: z.number(), min_history: nat }),
    pay_days_before_due: nat,
  }),
  subscriptions: z.strictObject({
    cancel: act,
    subscribe: act,
    renewal_notice_days: nat,
    renew_unseen_price_increase: z.enum(["confirm", "allow"]),
    auto_cancel_trials: z.strictObject({ enabled: z.boolean(), days_before_charge: nat, notify_days_before: nat }),
  }),
  savings_sweep: z
    .strictObject({ enabled: z.boolean(), on: z.string(), pct: z.number(), keep_buffer_for_bills: z.boolean(), undo_hours: nat })
    .optional(),
  budgets: z.strictObject({ move_between_categories: act }).optional(),
  prepaid: z.strictObject({
    purchase: act,
    escrow_only: z.boolean(),
    max_prepay: nat,
    auto_exit_on: z.array(z.enum(["court_enforcement", "closure_notice"])),
    attestation_max_age_days: nat,
    warn_on_soft_signals: z.boolean(),
  }),
  global: z.strictObject({
    daily_outflow_cap: nat,
    per_payee_daily_cap: z.record(z.string(), nat).optional(),
    expires_at: z.string().optional(),
  }),
});
export const MandateChangeRelation = z.enum(["first", "narrowing", "widening", "equivalent", "incomparable"]);
export const MandateFieldChange = z.strictObject({ path: z.string().min(1), direction: z.enum(["narrower", "wider", "incomparable"]) });
export const MandateCompileRequest = z.strictObject({ text: z.string().min(1).max(4000) });
export const MandateCompileResponse = z.strictObject({
  baseCurrency: z.enum(["CNY", "IDR"]),
  policy: DraftPolicy,
  defaulted: z.array(z.string().min(1)),
  readback: z.array(z.string().min(1)).min(1),
  relation: MandateChangeRelation,
  changes: z.array(MandateFieldChange),
});
export const MandateActivateRequest = z.strictObject({
  policy: DraftPolicy,
  createdVia: z.enum(["nl", "template", "edit"]),
  confirmWidening: z.boolean().optional(),
});
export const MandateActivateResponse = z.strictObject({
  version: z.number().int().positive(),
  hash: hash64,
  signedAt: iso,
  relation: MandateChangeRelation,
});
export const MandateActivateConflict = z.strictObject({
  error: z.string().min(1),
  code: z.literal("widening_needs_review"),
  relation: MandateChangeRelation,
  changes: z.array(MandateFieldChange),
});

export const AuditVerifyRow = z.strictObject({
  seq: z.number().int().positive(),
  at: iso,
  event: z.string().min(1),
  actor: z.enum(["agent", "user", "system"]),
  status: UiStatus.nullable(),
  ruleIds: z.array(z.string().min(1)),
  hash: hash64,
  tx: TxLink.optional(),
});
export const AuditVerifyResponse = z.strictObject({
  chainOk: z.boolean(),
  checkedAt: iso,
  count: z.number().int().nonnegative(),
  firstBreakSeq: z.number().int().positive().nullable(),
  rows: z.array(AuditVerifyRow),
});

// ---- compile-time drift checks -------------------------------------------------------------
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<X extends true> = X;
export type Checks = [
  Assert<Equal<z.infer<typeof UiStatus>, T.UiStatus>>,
  Assert<Equal<z.infer<typeof FeedCheck>, T.FeedCheck>>,
  Assert<Equal<z.infer<typeof FeedItem>, T.FeedItem>>,
  Assert<Equal<z.infer<typeof FeedResponse>, T.FeedResponse>>,
  Assert<Equal<z.infer<typeof FeedWhyResponse>, T.FeedWhyResponse>>,
  Assert<Equal<z.infer<typeof MandateActiveResponse>, T.MandateActiveResponse>>,
  Assert<Equal<z.infer<typeof MandateVersion>, T.MandateVersion>>,
  Assert<Equal<z.infer<typeof MandateHistoryResponse>, T.MandateHistoryResponse>>,
  Assert<Equal<z.infer<typeof MandateCompileRequest>, T.MandateCompileRequest>>,
  Assert<Equal<z.infer<typeof MandateCompileResponse>, T.MandateCompileResponse>>,
  Assert<Equal<z.infer<typeof MandateActivateRequest>, T.MandateActivateRequest>>,
  Assert<Equal<z.infer<typeof MandateActivateResponse>, T.MandateActivateResponse>>,
  Assert<Equal<z.infer<typeof MandateActivateConflict>, T.MandateActivateConflict>>,
  Assert<Equal<z.infer<typeof AuditVerifyRow>, T.AuditVerifyRow>>,
  Assert<Equal<z.infer<typeof AuditVerifyResponse>, T.AuditVerifyResponse>>,
];
