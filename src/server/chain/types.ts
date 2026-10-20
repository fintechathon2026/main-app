// Owner: R3 (roles.md §4).
// EIP-712 definitions of the PrepaidEscrow structs (architecture §24.3), shared by the mock
// escrow (verifies), the future chain adapter, the merchant simulator and browser signing.
// They must stay byte-identical to the type strings the contract hashes:
//   Offer(address merchant,uint128 unitPrice,uint32 units,uint16 cancelFeeBps,uint64 expiresAt,uint256 nonce)
//   PurchaseAuth(bytes32 offerHash,address consumer,address agent,uint64 deadline)
//   Redeem(uint256 planId,uint32 sessionNo,uint64 deadline)
//   VoluntaryExit(uint256 planId,uint64 deadline)
// The Attestation struct lives in src/sim/registry/eip712.ts; all five share one domain.
// Pure definitions only: no keys, no I/O.

import { hashTypedData, type Address, type Hex, type TypedDataDomain } from "viem";
import { attestationDomain, attestationDomainFromEnv } from "@/src/sim/registry/eip712";

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

/** Contract constants (PrepaidEscrow.MAX_ATTESTATION_AGE, MAX_CANCEL_FEE_BPS). */
export const MAX_ATTESTATION_AGE_SECONDS = 2 * 86_400;
export const MAX_CANCEL_FEE_BPS = 2000;

/** Domain {name: PrepaidEscrow, version: 1, chainId, verifyingContract}, the same as attestations. */
export const escrowDomain = attestationDomain;
export const escrowDomainFromEnv = attestationDomainFromEnv;

// ---- Wire formats (JSON-safe: amounts in fen and times in unix seconds as numbers; ids and
// nonces as decimal strings because they may exceed 2^53) -----------------------------------

export type OfferJson = {
  merchant: string;
  unitPrice: number;
  units: number;
  cancelFeeBps: number;
  expiresAt: number;
  nonce: string;
};

export type PurchaseAuthJson = { offerHash: string; consumer: string; agent: string; deadline: number };

export type RedeemJson = { planId: string; sessionNo: number; deadline: number };

export type VoluntaryExitJson = { planId: string; deadline: number };

// ---- Signed messages (viem types) ---------------------------------------------------------

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

export function toOfferMessage(o: OfferJson): OfferMessage {
  return {
    merchant: o.merchant as Address,
    unitPrice: BigInt(o.unitPrice),
    units: o.units,
    cancelFeeBps: o.cancelFeeBps,
    expiresAt: BigInt(o.expiresAt),
    nonce: BigInt(o.nonce),
  };
}

export function toPurchaseAuthMessage(a: PurchaseAuthJson): PurchaseAuthMessage {
  return { offerHash: a.offerHash as Hex, consumer: a.consumer as Address, agent: a.agent as Address, deadline: BigInt(a.deadline) };
}

export function toRedeemMessage(r: RedeemJson): RedeemMessage {
  return { planId: BigInt(r.planId), sessionNo: r.sessionNo, deadline: BigInt(r.deadline) };
}

export function toVoluntaryExitMessage(v: VoluntaryExitJson): VoluntaryExitMessage {
  return { planId: BigInt(v.planId), deadline: BigInt(v.deadline) };
}

/** EIP-712 digest of the offer (the contract's `offerHash`); the consumer's PurchaseAuth binds it. */
export function offerHash(domain: TypedDataDomain, offer: OfferJson): Hex {
  return hashTypedData({ domain, types: OFFER_TYPES, primaryType: "Offer", message: toOfferMessage(offer) });
}

/** EIP-712 digest of a purchase authorization (the contract's `authUsed` key). */
export function purchaseAuthDigest(domain: TypedDataDomain, auth: PurchaseAuthJson): Hex {
  return hashTypedData({ domain, types: PURCHASE_AUTH_TYPES, primaryType: "PurchaseAuth", message: toPurchaseAuthMessage(auth) });
}
