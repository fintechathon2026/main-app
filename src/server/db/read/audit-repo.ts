// Owner: R2 (roles.md). Newest audit entries for the Evidence screen. Runs in `withUserTx`, so RLS
// scopes rows to the user; the query also filters by user. Not exercised without a database.

import { verifyAuditChain } from "../../audit";
import { withUserTx } from "../pool";
import { type AuditEntry, type ChainCheck, buildAuditVerify } from "./audit-view";
import type { AuditVerifyResponse } from "../../api-types";

export const EVIDENCE_PAGE = 50;

export async function listRecentAudit(userId: string, limit = EVIDENCE_PAGE): Promise<AuditEntry[]> {
  return withUserTx(userId, async (tx) => {
    const r = await tx.query(
      `select seq, created_at, actor, event_type, hash, event_json
         from public.audit_log where user_id = $1 order by seq desc limit $2`,
      [userId, limit],
    );
    return r.rows.map((row) => ({
      seq: Number(row.seq),
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString(),
      actor: row.actor,
      eventType: row.event_type,
      hash: row.hash,
      event: row.event_json ?? {},
    }));
  });
}

/** Walks the whole chain (verifyAuditChain) and returns the newest page with its sentences. */
export async function loadAuditVerify(userId: string, now: string): Promise<AuditVerifyResponse> {
  const check: ChainCheck = await verifyAuditChain(userId);
  return buildAuditVerify(check, await listRecentAudit(userId), now);
}
