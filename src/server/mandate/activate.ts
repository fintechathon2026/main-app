// Owner: R2 (roles.md).
// Mandate activation (architecture §9.1, §9.2): insert a new mandate version, supersede the
// previous one and append a `mandate.activated` audit entry, all in one transaction.
//
// Every activation is classified against the active mandate with compareMandates
// (src/core/mandate/narrow.ts). Narrowing and equivalent changes activate at once; widening and
// incomparable ones (mixed = widening, architecture §9.1) need `confirmWidening`, which the
// Rules screen sends only after its 10-second review. R0 activates by session; passkey + UV is R1.
//
// G6: the LLM never calls this. The only caller is POST /api/mandates/activate (user-signed);
// src/agent/** may not import this module (eslint.config.mjs).

import type { PoolClient } from "pg";
import { hashPolicy } from "@/src/core/mandate/canonical";
import { type FieldChange, type MandateRelation, compareMandates } from "@/src/core/mandate/narrow";
import { type Policy as StoredPolicy, parsePolicy } from "@/src/core/mandate/schema";
import { appendAudit } from "@/src/server/audit";
import { withUserTx } from "@/src/server/db/pool";
import { type BaseCurrency, type Policy, PolicyDraft, withDefaults } from "./schema";

export type CreatedVia = "nl" | "template" | "edit";
/** "first" when the user had no active mandate. */
export type ChangeRelation = MandateRelation | "first";
export type ChangeClass = { relation: ChangeRelation; changes: FieldChange[] };

export type ActivateResult = {
  version: number;
  hash: string;
  signedAt: string;
  relation: ChangeRelation;
};

export type ActivateOutcome =
  | ({ ok: true } & ActivateResult)
  | { ok: false; code: "widening_needs_review"; relation: ChangeRelation; changes: FieldChange[] }
  | { ok: false; code: "invalid_policy"; errors: string[] }
  | { ok: false; code: "activation_conflict" };

/** Widening and incomparable changes need the user's explicit review (architecture §9.1). */
export const needsReview = (relation: ChangeRelation): boolean => relation === "widening" || relation === "incomparable";

/** Classify the change from the active mandate `prev` (null = none yet) to `next`. */
export function classifyChange(prev: StoredPolicy | null, next: StoredPolicy): ChangeClass {
  if (prev === null) return { relation: "first", changes: [] };
  return compareMandates(prev, next);
}

/**
 * The stored form of a complete policy: `version` stamped, then parsed with the strict core
 * schema the Gate uses. withDefaults' `alpha: 1` ("always confirm") is dropped, because the core
 * schema reads an absent alpha as always-confirm and only accepts alpha < 1 (decide.ts,
 * anomaly.ts treat both the same way).
 */
export function toStoredPolicy(policy: Policy, version: number): { ok: true; policy: StoredPolicy } | { ok: false; errors: string[] } {
  const { alpha, ...anomaly } = policy.bills.anomaly;
  const bills = { ...policy.bills, anomaly: alpha >= 1 ? anomaly : { ...anomaly, alpha } };
  // JSON round trip: what is hashed is exactly what jsonb stores and returns.
  const parsed = parsePolicy(JSON.parse(JSON.stringify({ ...policy, bills, version })));
  return parsed.ok ? { ok: true, policy: parsed.policy } : { ok: false, errors: parsed.errors };
}

/**
 * The request's policy (the compile route's complete draft, or any subset of it) as a strict
 * PolicyDraft. `base_currency` comes from the account, so a body value must match it; the
 * per-payee cap map is accepted in its stored form and turned back into the draft's list.
 */
export function parseActivatePolicy(raw: unknown): { ok: true; draft: PolicyDraft; baseCurrency?: string } | { ok: false; errors: string[] } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, errors: ["policy must be an object"] };
  const { base_currency, ...rest } = raw as Record<string, unknown>;
  const g = rest.global;
  if (g && typeof g === "object" && !Array.isArray(g)) {
    const caps = (g as Record<string, unknown>).per_payee_daily_cap;
    if (caps && typeof caps === "object" && !Array.isArray(caps)) {
      rest.global = { ...g, per_payee_daily_cap: Object.entries(caps).map(([biller_id, cap]) => ({ biller_id, cap })) };
    }
  }
  const r = PolicyDraft.safeParse(rest);
  if (!r.success) return { ok: false, errors: r.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`) };
  if (base_currency !== undefined && typeof base_currency !== "string") return { ok: false, errors: ["base_currency must be a string"] };
  return { ok: true, draft: r.data, ...(base_currency !== undefined ? { baseCurrency: base_currency } : {}) };
}

type ActiveRow = { version: number; policy: StoredPolicy };

/**
 * Serializes activations for one user, then loads the active mandate. An advisory lock (like
 * appendAudit's) also covers a user with no active row yet, which `for update` could not lock.
 */
async function lockAndLoadActive(tx: PoolClient, userId: string): Promise<ActiveRow | null> {
  await tx.query("select pg_advisory_xact_lock(hashtext('mandate:' || $1))", [userId]);
  const r = await tx.query(
    "select version, policy_json, policy_hash from public.mandates where user_id = $1 and status = 'active' for update",
    [userId],
  );
  const row = r.rows[0];
  if (!row) return null;
  // A tampered or malformed active row is an error, never a baseline to compare against.
  if (hashPolicy(row.policy_json) !== row.policy_hash) throw new Error("active mandate hash does not match its policy");
  const parsed = parsePolicy(row.policy_json);
  if (!parsed.ok) throw new Error(`active mandate is not valid: ${parsed.errors.join("; ")}`);
  return { version: Number(row.version), policy: parsed.policy };
}

/**
 * Activates `policy` inside `tx` (which must already hold the user's activation lock via
 * lockAndLoadActive) when the change is narrowing/equivalent/first, or widening with
 * `confirmWidening`. Writes nothing otherwise.
 */
async function activateLocked(
  tx: PoolClient,
  userId: string,
  active: ActiveRow | null,
  policy: Policy,
  createdVia: CreatedVia,
  confirmWidening: boolean,
): Promise<ActivateOutcome> {
  const v = await tx.query("select coalesce(max(version), 0) + 1 as next from public.mandates where user_id = $1", [userId]);
  const version = Number(v.rows[0].next);
  const stored = toStoredPolicy(policy, version);
  if (!stored.ok) return { ok: false, code: "invalid_policy", errors: stored.errors };

  const { relation, changes } = classifyChange(active?.policy ?? null, stored.policy);
  if (needsReview(relation) && !confirmWidening) return { ok: false, code: "widening_needs_review", relation, changes };

  const hash = hashPolicy(stored.policy);
  const signedAt = new Date().toISOString();
  await tx.query("update public.mandates set status = 'superseded' where user_id = $1 and status = 'active'", [userId]);
  await tx.query(
    `insert into public.mandates
      (user_id, version, policy_json, policy_hash, prev_version, signed_at, status, created_via)
     values ($1, $2, $3, $4, $5, $6, 'active', $7)`,
    [userId, version, JSON.stringify(stored.policy), hash, active?.version ?? null, signedAt, createdVia],
  );
  // G7: append-only, hash-chained.
  await appendAudit(tx, userId, {
    actor: "user",
    eventType: "mandate.activated",
    data: { version, hash, prevVersion: active?.version ?? null, relation, createdVia },
  });
  return { ok: true, version, hash, signedAt, relation };
}

const isUniqueViolation = (e: unknown) => (e as { code?: string } | null)?.code === "23505";

/** Runs `fn` in one user transaction; a unique violation (concurrent activation) is a conflict. */
async function inTx(userId: string, fn: (tx: PoolClient) => Promise<ActivateOutcome>): Promise<ActivateOutcome> {
  try {
    return await withUserTx(userId, fn);
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, code: "activation_conflict" };
    throw e;
  }
}

/** Activates a complete policy for `userId` (same review rule as activateReviewed). */
export async function activate(userId: string, policy: Policy, createdVia: CreatedVia, confirmWidening = false): Promise<ActivateOutcome> {
  return inTx(userId, (tx) => activateTx(tx, userId, policy, createdVia, confirmWidening));
}

/** Same as `activate` inside the caller's transaction. */
export async function activateTx(
  tx: PoolClient,
  userId: string,
  policy: Policy,
  createdVia: CreatedVia,
  confirmWidening = false,
): Promise<ActivateOutcome> {
  const active = await lockAndLoadActive(tx, userId);
  return activateLocked(tx, userId, active, policy, createdVia, confirmWidening);
}

/**
 * The route's entry point: everything is recomputed from the draft (defaults, version, hash,
 * classification); no client hash or direction is trusted. Defaults use the active mandate's
 * base currency (CNY when there is none).
 */
export async function activateReviewed(
  userId: string,
  draft: PolicyDraft,
  createdVia: CreatedVia,
  confirmWidening: boolean,
  bodyBaseCurrency?: string,
): Promise<ActivateOutcome> {
  return inTx(userId, async (tx) => {
    const active = await lockAndLoadActive(tx, userId);
    const base: BaseCurrency = active?.policy.base_currency ?? "CNY";
    if (bodyBaseCurrency !== undefined && bodyBaseCurrency !== base) {
      return { ok: false, code: "invalid_policy", errors: [`base_currency must be ${base}`] };
    }
    const { policy } = withDefaults(draft, base);
    return activateLocked(tx, userId, active, policy, createdVia, confirmWidening);
  });
}
