// Owner: R2 (roles.md). Minimal version by R1; extend, don't duplicate.
// Append-only, per-user hash-chained audit log (PRD §15.8, architecture §12.2, G7).
//   hash = sha256(prev_hash || canonical(event)),  event = {user_id, actor, event_type, event}
// Appends run inside the caller's transaction. A per-user advisory lock serializes appends
// (the table grants no UPDATE, so SELECT ... FOR UPDATE on the last row is not available).

import type { PoolClient } from "pg";
import { canonical, sha256Hex } from "@/src/core/mandate/canonical";
import { withUserTx } from "@/src/server/db/pool";

export const GENESIS_HASH = "0".repeat(64);

export type AuditActor = "agent" | "user" | "gate" | "system";
export type AuditEvent = { actor: AuditActor; eventType: string; data: Record<string, unknown> };

/** JSON round-trip so the hashed value equals what jsonb stores and returns. */
const normalize = (v: unknown) => JSON.parse(JSON.stringify(v ?? {}));

export function auditHash(prevHash: string, userId: string, actor: string, eventType: string, data: unknown): string {
  return sha256Hex(prevHash + canonical({ user_id: userId, actor, event_type: eventType, event: normalize(data) }));
}

export async function appendAudit(tx: PoolClient, userId: string, ev: AuditEvent): Promise<{ seq: number; hash: string }> {
  await tx.query("select pg_advisory_xact_lock(hashtext('audit:' || $1))", [userId]);
  const last = await tx.query("select hash from public.audit_log where user_id = $1 order by seq desc limit 1", [userId]);
  const prev: string = last.rows[0]?.hash ?? GENESIS_HASH;
  const data = normalize(ev.data);
  const hash = auditHash(prev, userId, ev.actor, ev.eventType, data);
  const r = await tx.query(
    `insert into public.audit_log (user_id, prev_hash, hash, actor, event_type, event_json)
     values ($1, $2, $3, $4, $5, $6) returning seq`,
    [userId, prev, hash, ev.actor, ev.eventType, JSON.stringify(data)],
  );
  return { seq: Number(r.rows[0].seq), hash };
}

export type AuditVerifyResult = { ok: boolean; count: number; firstBreakSeq: number | null; reason?: string };

/** Walk the user's chain and report the first break. */
export async function verifyAuditChain(userId: string): Promise<AuditVerifyResult> {
  return withUserTx(userId, async (tx) => {
    const r = await tx.query(
      "select seq, prev_hash, hash, actor, event_type, event_json from public.audit_log where user_id = $1 order by seq",
      [userId],
    );
    let prev = GENESIS_HASH;
    for (const row of r.rows) {
      if (row.prev_hash !== prev) return { ok: false, count: r.rowCount ?? 0, firstBreakSeq: Number(row.seq), reason: "prev_hash" };
      const h = auditHash(row.prev_hash, userId, row.actor, row.event_type, row.event_json);
      if (h !== row.hash) return { ok: false, count: r.rowCount ?? 0, firstBreakSeq: Number(row.seq), reason: "hash" };
      prev = row.hash;
    }
    return { ok: true, count: r.rowCount ?? 0, firstBreakSeq: null };
  });
}
