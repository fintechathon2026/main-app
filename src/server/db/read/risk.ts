// Hard and soft merchant signals (PRD §15.12, architecture §24.8). `attestations.sig_valid` is a
// UI cache only; the Gate re-verifies signatures at decision time and never trusts this column.

import { z } from "zod";
import { type Queryable, parseRows, zTs } from "./db";
import { RISK_LEVELS } from "./prepaid";

export const AttestationRow = z.object({
  id: z.string(),
  merchant_id: z.string(),
  kind: z.enum(["court_enforcement", "closure_notice"]),
  case_ref_hash: z.string(),
  issued_at: zTs,
  expires_at: zTs,
  signer: z.string(),
  sig_valid: z.boolean(),
  received_at: zTs.nullable(),
});
export type AttestationRow = z.output<typeof AttestationRow>;

export const RiskSignalRow = z.object({
  id: z.string(),
  merchant_id: z.string(),
  kind: z.enum(["complaints", "news"]),
  level: z.enum(RISK_LEVELS),
  summary: z.string().nullable(),
  source_ids: z.array(z.string()),
  origin: z.enum(["web", "simulated"]),
  simulated: z.boolean(),
  observed_at: zTs,
});
export type RiskSignalRow = z.output<typeof RiskSignalRow>;

export async function listAttestations(q: Queryable, merchantIds: string[]): Promise<AttestationRow[]> {
  if (merchantIds.length === 0) return [];
  const { rows } = await q.query(
    `select a.id::text as id, a.merchant_id, a.kind, a.case_ref_hash, a.issued_at::text as issued_at,
            a.expires_at::text as expires_at, a.signer, a.sig_valid, a.received_at::text as received_at
       from public.attestations a
      where a.merchant_id = any($1::text[])
      order by a.issued_at desc, a.id`,
    [merchantIds],
  );
  return parseRows(AttestationRow, rows, "attestations");
}

export async function listRiskSignals(q: Queryable, merchantIds: string[]): Promise<RiskSignalRow[]> {
  if (merchantIds.length === 0) return [];
  const { rows } = await q.query(
    `select r.id::text as id, r.merchant_id, r.kind, r.level, r.summary, r.source_ids, r.origin,
            r.simulated, r.observed_at::text as observed_at
       from public.risk_signals r
      where r.merchant_id = any($1::text[])
      order by r.observed_at desc, r.id`,
    [merchantIds],
  );
  return parseRows(RiskSignalRow, rows, "risk_signals");
}
