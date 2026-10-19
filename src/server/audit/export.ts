// Owner: R3 (roles.md). Audit export (architecture §13, §17; PRD §15.8): the user's chain as
// JSONL or CSV, with hashes so it can be re-verified offline.

import { withUserTx } from "@/src/server/db/pool";

export type AuditExportRow = { seq: number; createdAt: string; actor: string; eventType: string; prevHash: string; hash: string; event: unknown };

export function listAuditRows(userId: string, limit = 10_000): Promise<AuditExportRow[]> {
  return withUserTx(userId, async (tx) => {
    const r = await tx.query(
      "select seq, created_at, actor, event_type, prev_hash, hash, event_json from public.audit_log where user_id = $1 order by seq limit $2",
      [userId, limit],
    );
    return r.rows.map((x) => ({
      seq: Number(x.seq),
      createdAt: (x.created_at as Date).toISOString(),
      actor: x.actor,
      eventType: x.event_type,
      prevHash: x.prev_hash,
      hash: x.hash,
      event: x.event_json,
    }));
  });
}

const csvCell = (v: unknown) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  // Quote everything; neutralize spreadsheet formulas (CSV injection).
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replaceAll('"', '""')}"`;
};

export function toJsonl(rows: AuditExportRow[]): string {
  return rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : "");
}

export function toCsv(rows: AuditExportRow[]): string {
  const head = ["seq", "created_at", "actor", "event_type", "prev_hash", "hash", "event_json"].join(",");
  return [head, ...rows.map((r) => [r.seq, r.createdAt, r.actor, r.eventType, r.prevHash, r.hash, r.event].map(csvCell).join(","))].join("\n") + "\n";
}
