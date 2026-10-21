// Owner: R3 (roles.md).
// Known PrepaidEscrow deployments, so chain-sync can start at the deploy block instead of block 0
// when CHAIN_START_BLOCK is unset. A TS copy rather than a runtime JSON read (no fs, no JSON
// import attributes). Keep in sync with contracts/deployments/<chainId>.json; a test checks.

import type { Address } from "viem";

export const KNOWN_DEPLOYMENTS: Record<number, { escrow: Address; deployBlock: bigint }> = {
  84532: { escrow: "0xcf9e41a7891339D5229B2e3744d80Fe63B7337d0", deployBlock: BigInt(48356082) },
};
