// Owner: R3 (roles.md).
// EIP-2612 permit definitions for TestCNY (PRD_PrepaidEscrow_Contract §4.1). The escrow structs
// live in src/server/chain/types.ts. Pure definitions only: no keys, no I/O.

import type { Address, TypedDataDomain } from "viem";

export const TEST_CNY_NAME = "Test CNY (no value)";

export const PERMIT_TYPES = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/** TestCNY's permit domain: name = the token name, version "1". */
export function tokenDomain(cfg: { chainId: number | string; tokenAddress: Address }): TypedDataDomain {
  return { name: TEST_CNY_NAME, version: "1", chainId: Number(cfg.chainId), verifyingContract: cfg.tokenAddress };
}

/** Wire form of a permit (JSON-safe: amounts as decimal strings). The escrow contract takes it as a struct. */
export type PermitJson = { value: string; deadline: string; v: number; r: `0x${string}`; s: `0x${string}` };
