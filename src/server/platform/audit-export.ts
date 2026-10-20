// Owner: R3 (roles.md).
// Export of the user's own hash-chained audit log (PRD FR10.4, §15.8; G7) as JSONL or CSV. Reads
// under RLS for the signed-in user only. Each entry carries prevHash and hash, so the chain can
// be re-verified offline with auditHash() from src/server/audit.
// TODO(R3-08/R3-09): append the user's chain_txs with Basescan links once the chain adapter and
// indexer exist (mock escrow ids are not on any explorer).

import { toCsv, toJsonl } from "@/src/core/export/serialize";
import type { AuditExportEntry } from "../api-types";
import { withUserTx } from "../db/pool";

export type AuditExportFormat = "jsonl" | "csv";

export const AUDIT_EXPORT_COLUMNS = ["seq", "createdAt", "actor", "eventType", "prevHash", "hash", "event"] as const;

export async function listAuditEntries(userId: string): Promise<AuditExportEntry[]> {
  return withUserTx(userId, async (tx) => {
    const r = await tx.query(
      "select seq, created_at, actor, event_type, prev_hash, hash, event_json from public.audit_log where user_id = $1 order by seq",
      [userId],
    );
    return r.rows.map((row) => ({
      seq: Number(row.seq),
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      actor: row.actor,
      eventType: row.event_type,
      prevHash: row.prev_hash,
      hash: row.hash,
      event: row.event_json,
    }));
  });
}

export function serializeAudit(entries: AuditExportEntry[], format: AuditExportFormat): string {
  return format === "csv" ? toCsv([...AUDIT_EXPORT_COLUMNS], entries) : toJsonl(entries);
}

export async function exportAudit(userId: string, format: AuditExportFormat): Promise<string> {
  return serializeAudit(await listAuditEntries(userId), format);
}
