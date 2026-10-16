// Owner: R3 (roles.md). Minimal version by R1; extend, don't duplicate.
// EIP-712 definition of a registry attestation (PRD §15.12, architecture §24.3, §24.9). Shared
// by the registry simulator (signs) and the server (recovers the signer). It must stay
// byte-identical to the struct the PrepaidEscrow contract hashes:
//   Attestation(address merchant,uint8 kind,bytes32 caseRef,uint64 issuedAt,uint64 expiresAt)
// Pure definitions only: no keys, no I/O.

import type { Address, Hex, TypedDataDomain } from "viem";

export const ATTESTATION_TYPES = {
  Attestation: [
    { name: "merchant", type: "address" },
    { name: "kind", type: "uint8" },
    { name: "caseRef", type: "bytes32" },
    { name: "issuedAt", type: "uint64" },
    { name: "expiresAt", type: "uint64" },
  ],
} as const;

export const ATTESTATION_PRIMARY_TYPE = "Attestation" as const;

export type AttestationKind = "court_enforcement" | "closure_notice";

/** On-chain kind codes (PRD §15.12): 1 = court_enforcement, 2 = closure_notice. */
export const ATTESTATION_KIND_CODE: Record<AttestationKind, 1 | 2> = { court_enforcement: 1, closure_notice: 2 };

export function attestationKindFromCode(code: number): AttestationKind | null {
  if (code === 1) return "court_enforcement";
  if (code === 2) return "closure_notice";
  return null;
}

export const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";
export const DEFAULT_CHAIN_ID = 84532; // Base Sepolia

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Domain {name: PrepaidEscrow, version: 1, chainId, verifyingContract}. In mock escrow mode
 * (no ESCROW_ADDRESS) the verifying contract is the zero address. Signer and verifier must
 * build the domain from the same configuration.
 */
export function attestationDomain(cfg: { chainId?: number | string; escrowAddress?: string | null } = {}): TypedDataDomain {
  const chainId = Number(cfg.chainId ?? DEFAULT_CHAIN_ID);
  const escrow = cfg.escrowAddress && ADDRESS_RE.test(cfg.escrowAddress) ? (cfg.escrowAddress as Address) : ZERO_ADDRESS;
  return {
    name: "PrepaidEscrow",
    version: "1",
    chainId: Number.isSafeInteger(chainId) && chainId > 0 ? chainId : DEFAULT_CHAIN_ID,
    verifyingContract: escrow,
  };
}

/** Domain from the process environment (CHAIN_ID, ESCROW_ADDRESS). */
export function attestationDomainFromEnv(env: Record<string, string | undefined> = process.env): TypedDataDomain {
  return attestationDomain({ chainId: env.CHAIN_ID, escrowAddress: env.ESCROW_ADDRESS });
}

/** The signed message. Times are unix seconds. */
export type AttestationMessage = {
  merchant: Address;
  kind: 1 | 2;
  caseRef: Hex;
  issuedAt: bigint;
  expiresAt: bigint;
};

/**
 * Wire format served by `GET /sim/registry/attestations` (JSON-safe: seconds as numbers).
 * `simulated` marks every item from the simulator (architecture §24.7).
 */
export type AttestationJson = {
  merchant: string;
  kind: number;
  caseRef: string;
  issuedAt: number;
  expiresAt: number;
  signature: string;
  simulated?: boolean;
};

export function toAttestationMessage(a: Pick<AttestationJson, "merchant" | "kind" | "caseRef" | "issuedAt" | "expiresAt">): AttestationMessage {
  return {
    merchant: a.merchant as Address,
    kind: a.kind as 1 | 2,
    caseRef: a.caseRef as Hex,
    issuedAt: BigInt(a.issuedAt),
    expiresAt: BigInt(a.expiresAt),
  };
}
