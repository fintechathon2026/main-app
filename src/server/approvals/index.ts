// Owner: R2 (roles.md). Minimal version by R1; extend, don't duplicate.
// Approval tokens (architecture §8.3, PRD §10.5, G3). The approvals row is the only source of
// truth: bound to the action hash, expiring, single use. R0 approvals are session-authenticated;
// the WebAuthn assertion over action_hash arrives in R1 (decide step only).

import type { PoolClient } from "pg";
import { withUserTx } from "@/src/server/db/pool";
import { appendAudit } from "@/src/server/audit";

export const DEFAULT_APPROVAL_TTL_MINUTES = 15;

function ttlMinutes(): number {
  const v = Number(process.env.APPROVAL_TTL_MINUTES);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_APPROVAL_TTL_MINUTES;
}

export class ApprovalError extends Error {
  constructor(readonly code: "not_found" | "not_pending" | "expired" | "action_not_awaiting") {
    super(code);
  }
}

/**
 * Create a pending approval for an action (in the caller's transaction). Re-uses the open
 * approval for the same action hash if one exists. Moves the action to awaiting_approval.
 */
export async function createApprovalTx(tx: PoolClient, userId: string, actionId: string, ttl = ttlMinutes()): Promise<string> {
  const a = await tx.query(
    "select id, args_hash, mandate_version, status from public.actions where id = $1 and user_id = $2 for update",
    [actionId, userId],
  );
  const action = a.rows[0];
  if (!action) throw new ApprovalError("not_found");
  if (!["planned", "ready", "awaiting_approval"].includes(action.status)) throw new ApprovalError("action_not_awaiting");

  // Expire stale open approvals for this hash so the partial unique index admits a new one.
  await tx.query(
    "update public.approvals set status = 'expired' where action_hash = $1 and status in ('pending','approved') and expires_at <= now()",
    [action.args_hash],
  );
  const open = await tx.query(
    "select id from public.approvals where action_hash = $1 and action_id = $2 and status in ('pending','approved')",
    [action.args_hash, actionId],
  );
  let id: string;
  if (open.rowCount) {
    id = open.rows[0].id;
  } else {
    const r = await tx.query(
      `insert into public.approvals (user_id, action_id, action_hash, mandate_version, expires_at)
       values ($1, $2, $3, $4, now() + make_interval(mins => $5::int)) returning id`,
      [userId, actionId, action.args_hash, action.mandate_version, Math.round(ttl)],
    );
    id = r.rows[0].id;
    await appendAudit(tx, userId, { actor: "system", eventType: "approval.created", data: { approvalId: id, actionId } });
  }
  await tx.query("update public.actions set status = 'awaiting_approval' where id = $1 and status in ('planned','ready')", [actionId]);
  return id;
}

export function createApproval(userId: string, actionId: string): Promise<string> {
  return withUserTx(userId, (tx) => createApprovalTx(tx, userId, actionId));
}

/**
 * Owner approves or rejects (POST /api/approvals/:id). `userId` must come from the session.
 * RLS plus the explicit user_id filter make another user's approval look like not_found.
 */
export async function decideApproval(
  userId: string,
  approvalId: string,
  decision: "approve" | "reject",
  reason?: string,
): Promise<{ approvalId: string; actionId: string; status: "approved" | "rejected" }> {
  type Out = { approvalId: string; actionId: string; status: "approved" | "rejected" } | "expired";
  // The expiry bookkeeping must commit, so the error is thrown after the transaction.
  const res = await withUserTx<Out>(userId, async (tx) => {
    const r = await tx.query(
      "select id, action_id, status, expires_at <= now() as expired from public.approvals where id = $1 and user_id = $2 for update",
      [approvalId, userId],
    );
    const ap = r.rows[0];
    if (!ap) throw new ApprovalError("not_found");
    if (ap.status !== "pending") throw new ApprovalError("not_pending");
    if (ap.expired) {
      await tx.query("update public.approvals set status = 'expired' where id = $1", [approvalId]);
      await tx.query("update public.actions set status = 'expired' where id = $1 and status = 'awaiting_approval'", [ap.action_id]);
      await appendAudit(tx, userId, { actor: "system", eventType: "approval.expired", data: { approvalId, actionId: ap.action_id } });
      return "expired";
    }
    const status = decision === "approve" ? "approved" : "rejected";
    await tx.query("update public.approvals set status = $2, decided_at = now(), reason = $3 where id = $1", [approvalId, status, reason ?? null]);
    if (status === "rejected") {
      await tx.query("update public.actions set status = 'rejected' where id = $1 and status = 'awaiting_approval'", [ap.action_id]);
    }
    await appendAudit(tx, userId, { actor: "user", eventType: `approval.${status}`, data: { approvalId, actionId: ap.action_id, reason: reason ?? null } });
    return { approvalId, actionId: ap.action_id, status };
  });
  if (res === "expired") throw new ApprovalError("expired");
  return res;
}

/** Approval facts for the Gate snapshot: approved, same hash, not expired. */
export async function approvalState(tx: PoolClient, actionId: string, actionHash: string): Promise<{ valid: boolean; reason?: string } | null> {
  const r = await tx.query(
    `select status, action_hash, expires_at <= now() as expired from public.approvals
      where action_id = $1 order by created_at desc limit 1`,
    [actionId],
  );
  const ap = r.rows[0];
  if (!ap) return null;
  if (ap.action_hash !== actionHash) return { valid: false, reason: "hash_mismatch" };
  if (ap.status === "consumed") return { valid: false, reason: "consumed" };
  if (ap.status !== "approved") return { valid: false, reason: ap.status };
  if (ap.expired) return { valid: false, reason: "expired" };
  return { valid: true };
}

/** Consume exactly one approved, unexpired, hash-matching approval (phase B). */
export async function consumeApproval(tx: PoolClient, actionId: string, actionHash: string): Promise<boolean> {
  const r = await tx.query(
    `update public.approvals set status = 'consumed', consumed_at = now()
      where action_id = $1 and action_hash = $2 and status = 'approved' and expires_at > now()`,
    [actionId, actionHash],
  );
  return r.rowCount === 1;
}

/** Cleanup job: expire open approvals past expiry for one user. */
export function expireApprovals(userId: string): Promise<number> {
  return withUserTx(userId, async (tx) => {
    const r = await tx.query(
      `update public.approvals set status = 'expired'
        where user_id = $1 and status in ('pending','approved') and expires_at <= now() returning action_id`,
      [userId],
    );
    for (const row of r.rows) {
      await tx.query("update public.actions set status = 'expired' where id = $1 and status = 'awaiting_approval'", [row.action_id]);
    }
    return r.rowCount ?? 0;
  });
}
