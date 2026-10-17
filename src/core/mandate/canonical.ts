// Owner: R2 (roles.md). Minimal version by R1; extend, don't duplicate.
// Canonical JSON (RFC 8785 via `canonicalize`) and SHA-256 hashes (PRD §9.1, §10.5, §15.8).
// Pure: hashing is computation, not I/O.

import { createHash } from "node:crypto";
import canonicalizeJson from "canonicalize";

/** RFC 8785 canonical JSON. Throws on values JSON cannot represent. */
export function canonical(value: unknown): string {
  const out = canonicalizeJson(value);
  if (out === undefined) throw new TypeError("canonical: value is not JSON-serializable");
  return out;
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** Mandate hash = sha256(canonical(policy_json)). */
export function hashPolicy(policy: unknown): string {
  return sha256Hex(canonical(policy));
}

/**
 * Action hash = sha256(tool + canonical(args)) (PRD §10.5). Stored as `actions.args_hash`
 * and bound into approvals as `approvals.action_hash`.
 */
export function actionHash(tool: string, args: unknown): string {
  return sha256Hex(tool + canonical(args));
}
