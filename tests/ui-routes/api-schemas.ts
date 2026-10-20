// Owner: R2 (roles.md).
// Zod mirror of the R2 response types in src/server/api-types.ts (UI read routes). Objects are
// strict, so a fixture with an extra or misspelled field fails. The `Equal` checks below fail
// `tsc` if the mirror and the TypeScript types drift apart.

import { z } from "zod";
import type * as T from "@/src/server/api-types";

export const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
export const hash64 = z.string().regex(/^[0-9a-f]{64}$/);

export const UiStatus = z.enum(["done", "ask", "suggest", "blocked"]);

const TxLink = z.strictObject({ hash: z.string().min(1), explorerUrl: z.string() });

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
  Assert<Equal<z.infer<typeof AuditVerifyRow>, T.AuditVerifyRow>>,
  Assert<Equal<z.infer<typeof AuditVerifyResponse>, T.AuditVerifyResponse>>,
];
