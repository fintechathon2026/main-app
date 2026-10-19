// Owner: R2 (roles.md). Mandate versions in Postgres (architecture §9, §14.4; PRD §9.1, G6).
// Only the user activates a mandate (session route); the agent has no path here. A new version
// supersedes the active one in one transaction with an audit entry. Phase B of the executor
// re-decides every in-flight action under the new version anyway (PRD §10.6), so activation does
// not need to re-run the Gate; it only expires approvals whose actions were planned under an
// older version and are waiting, so a stale card cannot be approved out of context.

import type { PoolClient } from "pg";
import { hashPolicy } from "@/src/core/mandate/canonical";
import { parsePolicy, type Policy as CorePolicy } from "@/src/core/mandate/schema";
import { appendAudit } from "@/src/server/audit";
import { expireOpenApprovalsFor } from "@/src/server/approvals";
import { withUserTx } from "@/src/server/db/pool";
import { diffPolicies, type ChangeClass, type DiffEntry } from "./diff";
import { readback } from "./readback";
import type { Policy } from "./schema";

export type MandateVersion = {
  version: number;
  policy: Policy;
  policyHash: string;
  status: "active" | "superseded" | "revoked";
  createdVia: "nl" | "template" | "edit";
  signedAt: string;
  readback: string[];
};

export type MandateActiveResponse = { mandate: MandateVersion | null };
export type MandateHistoryResponse = { versions: (Omit<MandateVersion, "policy" | "readback"> & { diff: DiffEntry[]; class: ChangeClass })[] };
export type ActivateResponse = { mandate: MandateVersion; diff: DiffEntry[]; class: ChangeClass; expiredApprovals: number };

export class MandateActivateError extends Error {
  constructor(readonly code: "invalid_policy" | "hash_mismatch" | "stale_base" | "widening_not_confirmed") {
    super(code);
  }
}

type Row = { version: number; policy_json: Policy; policy_hash: string; status: MandateVersion["status"]; created_via: MandateVersion["createdVia"]; signed_at: Date };

const toVersion = (r: Row): MandateVersion => ({
  version: r.version,
  policy: r.policy_json,
  policyHash: r.policy_hash,
  status: r.status,
  createdVia: r.created_via,
  signedAt: r.signed_at.toISOString(),
  readback: readback(r.policy_json),
});

async function activeRow(tx: PoolClient, userId: string, lock = false): Promise<Row | null> {
  const r = await tx.query<Row>(
    `select version, policy_json, policy_hash, status, created_via, signed_at from public.mandates
      where user_id = $1 and status = 'active'${lock ? " for update" : ""}`,
    [userId],
  );
  return r.rows[0] ?? null;
}

export function getActiveMandate(userId: string): Promise<MandateActiveResponse> {
  return withUserTx(userId, async (tx) => {
    const row = await activeRow(tx, userId);
    return { mandate: row ? toVersion(row) : null };
  });
}

export function getMandateHistory(userId: string): Promise<MandateHistoryResponse> {
  return withUserTx(userId, async (tx) => {
    const r = await tx.query<Row>(
      "select version, policy_json, policy_hash, status, created_via, signed_at from public.mandates where user_id = $1 order by version",
      [userId],
    );
    let prev: Policy | null = null;
    const versions = r.rows.map((row) => {
      const d = prev ? diffPolicies(prev, row.policy_json) : { entries: [], class: "none" as ChangeClass };
      prev = row.policy_json;
      return { version: row.version, policyHash: row.policy_hash, status: row.status, createdVia: row.created_via, signedAt: row.signed_at.toISOString(), diff: d.entries, class: d.class };
    });
    return { versions: versions.reverse() };
  });
}

/** Diff of a candidate against the active version, for the editor's read-back step. */
export function previewAgainstActive(userId: string, candidate: Policy): Promise<{ activeVersion: number | null; diff: DiffEntry[]; class: ChangeClass }> {
  return withUserTx(userId, async (tx) => {
    const row = await activeRow(tx, userId);
    const d = diffPolicies(row?.policy_json ?? null, candidate);
    return { activeVersion: row?.version ?? null, diff: d.entries, class: d.class };
  });
}

/**
 * Activate `candidate` as the next version. `baseVersion` must be the active version the user
 * reviewed against (no lost updates), `policyHash` the hash of what they reviewed, and widening
 * changes need `confirmWidening` (the passkey replaces this in R1).
 */
export function activateMandate(
  userId: string,
  input: { candidate: Omit<Policy, never>; policyHash: string; baseVersion: number | null; createdVia: "nl" | "edit" | "template"; confirmWidening: boolean },
): Promise<ActivateResponse> {
  return withUserTx(userId, async (tx) => {
    const active = await activeRow(tx, userId, true);
    if ((active?.version ?? null) !== input.baseVersion) throw new MandateActivateError("stale_base");

    const version = (active?.version ?? 0) + 1;
    const policyJson = { ...input.candidate, version };
    // The Gate parses policy_json with the core schema; refuse anything it would not accept.
    const parsed = parsePolicy(policyJson);
    if (!parsed.ok) throw new MandateActivateError("invalid_policy");
    if (hashPolicy(input.candidate) !== input.policyHash) throw new MandateActivateError("hash_mismatch");

    const d = diffPolicies(active?.policy_json ?? null, input.candidate);
    if (d.class === "widening" && !input.confirmWidening) throw new MandateActivateError("widening_not_confirmed");

    if (active) await tx.query("update public.mandates set status = 'superseded' where user_id = $1 and version = $2", [userId, active.version]);
    const storedHash = hashPolicy(policyJson as CorePolicy);
    const ins = await tx.query<Row>(
      `insert into public.mandates (user_id, version, policy_json, policy_hash, prev_version, signed_at, status, created_via)
       values ($1, $2, $3, $4, $5, now(), 'active', $6)
       returning version, policy_json, policy_hash, status, created_via, signed_at`,
      [userId, version, JSON.stringify(policyJson), storedHash, active?.version ?? null, input.createdVia],
    );

    // §14.4: cards planned under an older version should not be approved out of context.
    const stale = await tx.query<{ id: string }>(
      "select id from public.actions where user_id = $1 and status = 'awaiting_approval' and mandate_version < $2",
      [userId, version],
    );
    const ids = stale.rows.map((r) => r.id);
    await expireOpenApprovalsFor(tx, userId, ids, "mandate_changed");
    if (ids.length) await tx.query("update public.actions set status = 'expired' where id = any($1::uuid[]) and status = 'awaiting_approval'", [ids]);

    await appendAudit(tx, userId, {
      actor: "user",
      eventType: "mandate.activated",
      data: { version, prevVersion: active?.version ?? null, policyHash: storedHash, class: d.class, changes: d.entries.map((e) => e.path), createdVia: input.createdVia },
    });
    return { mandate: toVersion(ins.rows[0]), diff: d.entries, class: d.class, expiredApprovals: ids.length };
  });
}
