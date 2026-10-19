// Owner: R3 (roles.md).
// EIP-712 definitions of every struct PrepaidEscrow verifies (PRD_PrepaidEscrow_Contract §4.3).
// They must stay byte-identical to the type hashes in contracts/src/PrepaidEscrow.sol;
// tests/chain/eip712.test.ts checks them against the deployed contract's hash* views.
// Attestation lives in src/sim/registry/eip712.ts (one definition, re-exported here).
// Pure definitions only: no keys, no I/O. Simulators may import this module (architecture §5.1).

import type { Address, Hex, TypedDataDomain } from "viem";
import { ATTESTATION_PRIMARY_TYPE, ATTESTATION_TYPES, DEFAULT_CHAIN_ID, attestationDomain } from "@/src/sim/registry/eip712";

export { ATTESTATION_PRIMARY_TYPE, ATTESTATION_TYPES };

export const OFFER_TYPES = {
  Offer: [
    { name: "merchant", type: "address" },
    { name: "unitPrice", type: "uint128" },
    { name: "units", type: "uint32" },
    { name: "cancelFeeBps", type: "uint16" },
    { name: "expiresAt", type: "uint64" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export const PURCHASE_AUTH_TYPES = {
  PurchaseAuth: [
    { name: "offerHash", type: "bytes32" },
    { name: "consumer", type: "address" },
    { name: "agent", type: "address" },
    { name: "deadline", type: "uint64" },
  ],
} as const;

export const REDEEM_TYPES = {
  Redeem: [
    { name: "planId", type: "uint256" },
    { name: "sessionNo", type: "uint32" },
    { name: "deadline", type: "uint64" },
  ],
} as const;

export const VOLUNTARY_EXIT_TYPES = {
  VoluntaryExit: [
    { name: "planId", type: "uint256" },
    { name: "deadline", type: "uint64" },
  ],
} as const;

/** Signed messages. Amounts in fen, times in unix seconds. */
export type OfferMessage = {
  merchant: Address;
  unitPrice: bigint;
  units: number;
  cancelFeeBps: number;
  expiresAt: bigint;
  nonce: bigint;
};
export type PurchaseAuthMessage = { offerHash: Hex; consumer: Address; agent: Address; deadline: bigint };
export type RedeemMessage = { planId: bigint; sessionNo: number; deadline: bigint };
export type VoluntaryExitMessage = { planId: bigint; deadline: bigint };

/** EIP-2612 permit of TestCNY (domain name = the token name, version "1"). */
export const PERMIT_TYPES = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;
export const TEST_CNY_NAME = "Test CNY (no value)";

/**
 * Escrow domain {PrepaidEscrow, 1, chainId, escrow}. Same builder as the attestation domain, so
 * every signature the escrow checks shares one domain.
 */
export function escrowDomain(cfg: { chainId?: number | string; escrowAddress?: string | null }): TypedDataDomain {
  return attestationDomain(cfg);
}

export function tokenDomain(cfg: { chainId?: number | string; tokenAddress: Address }): TypedDataDomain {
  const chainId = Number(cfg.chainId ?? DEFAULT_CHAIN_ID);
  return { name: TEST_CNY_NAME, version: "1", chainId, verifyingContract: cfg.tokenAddress };
}

/** Contract Status enum (PrepaidEscrow.Status) → the status strings used in the database. */
export const PLAN_STATUS = ["none", "active", "completed", "exited_attested", "exited_voluntary"] as const;
export type ChainPlanStatus = Exclude<(typeof PLAN_STATUS)[number], "none">;

export function planStatusFromCode(code: number): ChainPlanStatus | null {
  const s = PLAN_STATUS[code];
  return s && s !== "none" ? s : null;
}
