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

export const AuditVerifyRow =z.strictObject({
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
  Assert<Equal<z.infer<typeof AuditVerifyRow>, T.AuditVerifyRow>>,
  Assert<Equal<z.infer<typeof AuditVerifyResponse>, T.AuditVerifyResponse>>,
];
