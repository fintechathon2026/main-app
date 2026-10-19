// Owner: R3 (roles.md).
// Zod mirror of the R3 response types in src/server/api-types.ts. Objects are strict, so a fixture
// with an extra or misspelled field fails. The `Equal` checks below fail `tsc` if the mirror and
// the TypeScript types drift apart.

import { z } from "zod";
import type * as T from "@/src/server/api-types";

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
const hash = z.string().regex(/^[0-9a-f]{64}$/);

export const KillSwitchResponse = z.strictObject({ enabled: z.boolean(), changedAt: iso.nullable() });

export const SettingsResponse = z.strictObject({
  profile: z.strictObject({
    email: z.string().nullable(),
    displayName: z.string().nullable(),
    locale: z.string(),
    timezone: z.string(),
    baseCurrency: z.string().regex(/^[A-Z]{3}$/),
  }),
  killSwitch: KillSwitchResponse,
  mandateVersion: z.number().int().positive().nullable(),
  dataSources: z.array(
    z.strictObject({
      id: z.string(),
      type: z.string(),
      status: z.enum(["active", "paused", "revoked"]),
      lastSyncedAt: iso.nullable(),
    }),
  ),
});

export const SettingsUpdateRequest = z.strictObject({
  displayName: z.string().optional(),
  locale: z.string().optional(),
  timezone: z.string().optional(),
});

export const CronJob = z.enum(["fx", "detect", "risk", "cleanup", "chain-sync"]);

export const RunNowResponse = z.strictObject({
  job: CronJob,
  ok: z.boolean(),
  scope: z.enum(["user", "global"]),
  ranAt: iso,
  stats: z.record(z.string(), z.unknown()),
});

export const AuditExportEntry = z.strictObject({
  seq: z.number().int().positive(),
  createdAt: iso,
  actor: z.enum(["agent", "user", "gate", "system"]),
  eventType: z.string().min(1),
  prevHash: hash,
  hash,
  event: z.record(z.string(), z.unknown()),
});
export const AuditExport = z.array(AuditExportEntry);

// ---- compile-time drift checks -------------------------------------------------------------
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<X extends true> = X;
export type Checks = [
  Assert<Equal<z.infer<typeof KillSwitchResponse>, T.KillSwitchResponse>>,
  Assert<Equal<z.infer<typeof SettingsResponse>, T.SettingsResponse>>,
  Assert<Equal<z.infer<typeof SettingsUpdateRequest>, T.SettingsUpdateRequest>>,
  Assert<Equal<z.infer<typeof CronJob>, T.CronJob>>,
  Assert<Equal<z.infer<typeof RunNowResponse>, T.RunNowResponse>>,
  Assert<Equal<z.infer<typeof AuditExportEntry>, T.AuditExportEntry>>,
];
