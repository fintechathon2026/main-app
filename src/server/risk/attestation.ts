// Attestation checks for the risk job (PRD §15.12, FR19.4, architecture §24.9).
// The job is not the security boundary: it decides only whether to START a prepaid_risk plan.
// The Gate (via the executor's phase A) and the contract re-check every attestation; the
// stored `sig_valid` is a UI cache.

import { recoverTypedDataAddress, type Hex, type TypedDataDomain } from "viem";
import { z } from "zod";
import {
  ATTESTATION_PRIMARY_TYPE,
  ATTESTATION_TYPES,
  attestationKindFromCode,
  toAttestationMessage,
  type AttestationKind,
} from "@/src/sim/registry/eip712";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const MAX_U64_SAFE = Number.MAX_SAFE_INTEGER;

/** Fixed maximum age the contract enforces on its own (PRD §15.12 #3). */
export const CONTRACT_MAX_AGE_DAYS = 2;
/** Clock skew tolerated for issuedAt in the future. */
export const FUTURE_SKEW_SECONDS = 300;

/** One attestation as the registry serves it. Validated: it comes from an outside party. */
export const AttestationWire = z.object({
  merchant: z.string().regex(ADDRESS),
  kind: z.number().int().min(0).max(255),
  caseRef: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  issuedAt: z.number().int().min(0).max(MAX_U64_SAFE),
  expiresAt: z.number().int().min(0).max(MAX_U64_SAFE),
  signature: z.string().regex(/^0x[0-9a-fA-F]{1,512}$/),
  simulated: z.boolean().optional(),
});
export type AttestationWire = z.infer<typeof AttestationWire>;

/** Recovers the EIP-712 signer; null when the signature cannot be parsed. */
export async function recoverAttestationSigner(att: AttestationWire, domain: TypedDataDomain): Promise<string | null> {
  try {
    return await recoverTypedDataAddress({
      domain,
      types: ATTESTATION_TYPES,
      primaryType: ATTESTATION_PRIMARY_TYPE,
      message: toAttestationMessage(att),
      signature: att.signature as Hex,
    });
  } catch {
    return null;
  }
}

export type VerifiedAttestation = {
  att: AttestationWire;
  kind: AttestationKind;
  signer: string | null;
  sigValid: boolean;
};

/** Signature check against the configured oracle address. No oracle configured: never valid. */
export async function verifyAttestation(
  att: AttestationWire,
  opts: { domain: TypedDataDomain; oracleAddress: string | null },
): Promise<VerifiedAttestation | null> {
  const kind = attestationKindFromCode(att.kind);
  if (!kind) return null;
  const signer = await recoverAttestationSigner(att, opts.domain);
  const oracle = opts.oracleAddress && ADDRESS.test(opts.oracleAddress) ? opts.oracleAddress.toLowerCase() : null;
  return { att, kind, signer, sigValid: !!oracle && !!signer && signer.toLowerCase() === oracle };
}

export type FreshnessReason = "future" | "expired" | "stale" | "no_mandate";

/**
 * Time checks (PRD §15.12 #3): now ≤ expiresAt and now − issuedAt ≤ attestation_max_age_days,
 * capped by the contract's fixed maximum. `maxAgeDays` null = no active mandate.
 */
export function freshness(att: Pick<AttestationWire, "issuedAt" | "expiresAt">, nowMs: number, maxAgeDays: number | null):
  | { ok: true; ageDays: number }
  | { ok: false; reason: FreshnessReason } {
  const nowS = nowMs / 1000;
  if (maxAgeDays === null) return { ok: false, reason: "no_mandate" };
  if (att.issuedAt > nowS + FUTURE_SKEW_SECONDS) return { ok: false, reason: "future" };
  if (nowS > att.expiresAt) return { ok: false, reason: "expired" };
  const ageDays = Math.max(0, nowS - att.issuedAt) / 86_400;
  if (ageDays > Math.min(maxAgeDays, CONTRACT_MAX_AGE_DAYS)) return { ok: false, reason: "stale" };
  return { ok: true, ageDays };
}
