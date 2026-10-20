// Owner: R2 (roles.md). Pure signature checks for a prepaid purchase (architecture §24.3, §24.9, ADR-012).
// A purchase carries two EIP-712 signatures over the escrow domain: the merchant's over
// Offer(...) and the user's over PurchaseAuth(offerHash, consumer, agent, deadline). This module
// only RECOVERS the signer addresses and compares them with addresses the caller read from our
// own rows (wallets, prepaid_merchants, prepaid_offers). It signs nothing, holds no key, reads no
// env, no clock and no database: `domain` and `nowSeconds` are injected (G2, G9/G10). The
// contract re-checks everything at purchase time. Never log signatures.
//
// Wiring (owner of snapshot.ts, not done here). Phase A, for `prepaid_purchase`, call
// `purchaseSignatureFacts(...)` and fill:
//   prepaid.offer.merchantSigValid  <- facts.merchantSigValid
//   prepaid.offer.expired           <- facts.expired
//   prepaid.offer.termsMatchStored  <- facts.termsMatchStored
//   prepaid.consumerSigValid        <- facts.consumerSigValid
// `offer.escrowSupported` and `offer.totalBase` come from prepaid_merchants / the stored offer,
// not from this module. Pass `escrowDomainFromEnv()` as `domain` and the executor clock as `nowSeconds`.

import { hashTypedData, recoverTypedDataAddress, type Hex, type TypedDataDomain } from "viem";
import {
  OFFER_TYPES,
  PURCHASE_AUTH_TYPES,
  toOfferMessage,
  toPurchaseAuthMessage,
  type OfferJson,
  type PurchaseAuthJson,
} from "@/src/server/chain/types";

/** Stable reason strings. */
export type PurchaseSignatureReason =
  | "malformed_signature"
  | "malformed_message"
  | "terms_mismatch"
  | "offer_expired"
  | "deadline_expired"
  | "offer_hash_mismatch"
  | "consumer_mismatch"
  | "agent_mismatch"
  | "wrong_signer";

export type SignatureCheck<T extends object = object> = ({ ok: true } & T) | { ok: false; reason: PurchaseSignatureReason };

const SIG_RE = /^0x[0-9a-fA-F]{130}$/;
/** secp256k1 n / 2: OpenZeppelin ECDSA reverts on any s above it (signature malleability). */
const HALF_N = BigInt("0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0");

/**
 * True for a 65-byte r||s||v signature the contract's ECDSA library would accept: well-formed hex,
 * s in 1..n/2 (no high-s twin) and v in {0, 1, 27, 28}. Checked before any recovery so a
 * non-canonical signature is never reported valid off-chain when it would revert on chain.
 */
export function isCanonicalSignature(sig: unknown): sig is Hex {
  if (typeof sig !== "string" || !SIG_RE.test(sig)) return false;
  const s = BigInt(`0x${sig.slice(66, 130)}`);
  const v = parseInt(sig.slice(130, 132), 16);
  return s > BigInt(0) && s <= HALF_N && (v === 0 || v === 1 || v === 27 || v === 28);
}
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const sameAddress = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && ADDRESS_RE.test(a) && ADDRESS_RE.test(b) && a.toLowerCase() === b.toLowerCase();

type Recovered = { ok: true; signer: string } | { ok: false; reason: "malformed_signature" | "malformed_message" };

async function recoverOffer(domain: TypedDataDomain, offer: OfferJson, sig: string): Promise<Recovered> {
  if (!isCanonicalSignature(sig)) return { ok: false, reason: "malformed_signature" };
  let message;
  try {
    message = toOfferMessage(offer);
  } catch {
    return { ok: false, reason: "malformed_message" };
  }
  try {
    const signer = await recoverTypedDataAddress({ domain, types: OFFER_TYPES, primaryType: "Offer", message, signature: sig as Hex });
    return { ok: true, signer };
  } catch {
    return { ok: false, reason: "malformed_signature" };
  }
}

async function recoverAuth(domain: TypedDataDomain, auth: PurchaseAuthJson, sig: string): Promise<Recovered> {
  if (!isCanonicalSignature(sig)) return { ok: false, reason: "malformed_signature" };
  let message;
  try {
    message = toPurchaseAuthMessage(auth);
  } catch {
    return { ok: false, reason: "malformed_message" };
  }
  try {
    const signer = await recoverTypedDataAddress({ domain, types: PURCHASE_AUTH_TYPES, primaryType: "PurchaseAuth", message, signature: sig as Hex });
    return { ok: true, signer };
  } catch {
    return { ok: false, reason: "malformed_signature" };
  }
}

/** Recovers the signer of an Offer; null when the signature or message cannot be parsed. */
export async function recoverOfferSigner(domain: TypedDataDomain, offer: OfferJson, merchantSig: string): Promise<string | null> {
  const r = await recoverOffer(domain, offer, merchantSig);
  return r.ok ? r.signer : null;
}

/** Recovers the signer of a PurchaseAuth; null when the signature or message cannot be parsed. */
export async function recoverPurchaseAuthSigner(domain: TypedDataDomain, auth: PurchaseAuthJson, consumerSig: string): Promise<string | null> {
  const r = await recoverAuth(domain, auth, consumerSig);
  return r.ok ? r.signer : null;
}

/** True when every signed term equals the stored one (addresses compared case-insensitively). */
export function offerTermsEqual(a: OfferJson, b: OfferJson): boolean {
  try {
    return (
      sameAddress(a.merchant, b.merchant) &&
      a.unitPrice === b.unitPrice &&
      a.units === b.units &&
      a.cancelFeeBps === b.cancelFeeBps &&
      a.expiresAt === b.expiresAt &&
      BigInt(a.nonce) === BigInt(b.nonce)
    );
  } catch {
    return false;
  }
}

export type MerchantOfferExpectation = {
  /** Merchant address from prepaid_merchants.chain_address. */
  merchant: string;
  /** The terms stored in prepaid_offers; the signed offer must equal them. */
  storedOffer: OfferJson;
  nowSeconds: number;
};

/**
 * Checks the merchant's signed offer: terms equal the stored offer, not expired at `nowSeconds`
 * (valid while `expiresAt > now`), signature recovers to the expected merchant.
 */
export async function verifyMerchantOffer(
  domain: TypedDataDomain,
  offer: OfferJson,
  merchantSig: string,
  expected: MerchantOfferExpectation,
): Promise<SignatureCheck<{ signer: string; offerHash: Hex }>> {
  const rec = await recoverOffer(domain, offer, merchantSig);
  if (!rec.ok) return rec;
  if (!offerTermsEqual(offer, expected.storedOffer)) return { ok: false, reason: "terms_mismatch" };
  if (!(offer.expiresAt > expected.nowSeconds)) return { ok: false, reason: "offer_expired" };
  if (!sameAddress(rec.signer, expected.merchant)) return { ok: false, reason: "wrong_signer" };
  const hash = hashTypedData({ domain, types: OFFER_TYPES, primaryType: "Offer", message: toOfferMessage(offer) });
  return { ok: true, signer: rec.signer, offerHash: hash };
}

export type ConsumerAuthExpectation = {
  /** The user's consumer_browser wallet address. */
  owner: string;
  /**
   * Agent address the plan must name (AGENT_ADDRESS). `undefined` (omitted) skips the agent check;
   * `null` means "no agent may be named" and fails with `agent_mismatch` for any auth.
   */
  agent?: string | null;
  /** EIP-712 digest of the offer this purchase is for (from `verifyMerchantOffer`). */
  offerHash: string;
  nowSeconds: number;
};

/**
 * Checks the user's PurchaseAuth: bound to the same offer hash, names the owner as consumer (and
 * the expected agent), unexpired (valid while `deadline > now`), and recovers to the owner.
 */
export async function verifyConsumerPurchaseAuth(
  domain: TypedDataDomain,
  auth: PurchaseAuthJson,
  consumerSig: string,
  expected: ConsumerAuthExpectation,
): Promise<SignatureCheck<{ signer: string }>> {
  const rec = await recoverAuth(domain, auth, consumerSig);
  if (!rec.ok) return rec;
  if (auth.offerHash.toLowerCase() !== expected.offerHash.toLowerCase()) return { ok: false, reason: "offer_hash_mismatch" };
  if (!sameAddress(auth.consumer, expected.owner)) return { ok: false, reason: "consumer_mismatch" };
  if (expected.agent !== undefined && !sameAddress(auth.agent, expected.agent)) return { ok: false, reason: "agent_mismatch" };
  if (!(auth.deadline > expected.nowSeconds)) return { ok: false, reason: "deadline_expired" };
  if (!sameAddress(rec.signer, expected.owner)) return { ok: false, reason: "wrong_signer" };
  return { ok: true, signer: rec.signer };
}

export type PurchaseSignatureFacts = {
  merchantSigValid: boolean;
  expired: boolean;
  termsMatchStored: boolean;
  consumerSigValid: boolean;
  /** Why each signature failed, for the audit record; null when it passed. */
  merchantReason: PurchaseSignatureReason | null;
  consumerReason: PurchaseSignatureReason | null;
};

export type PurchaseSignatureInput = {
  offer: OfferJson;
  merchantSig: string;
  auth: PurchaseAuthJson;
  consumerSig: string;
};

export type PurchaseExpectation = {
  owner: string;
  merchant: string;
  /** As `ConsumerAuthExpectation.agent`: omitted skips the check, `null` always fails it. */
  agent?: string | null;
  storedOffer: OfferJson;
  nowSeconds: number;
};

/**
 * Runs both checks and maps them to the Gate's booleans. `merchantSigValid` is true only when the
 * offer as supplied was signed by the expected merchant AND its terms equal the stored offer, so a
 * merchant signature over other terms never counts (expiry is the separate `expired` fact;
 * `termsMatchStored` is also reported on its own). The consumer's PurchaseAuth is checked against
 * the digest of the offer as supplied, so it must bind exactly that offer.
 */
async function purchaseSignatureFactsUnchecked(
  domain: TypedDataDomain,
  input: PurchaseSignatureInput,
  expected: PurchaseExpectation,
): Promise<PurchaseSignatureFacts> {
  const merchant = await verifyMerchantOffer(domain, input.offer, input.merchantSig, {
    merchant: expected.merchant,
    storedOffer: expected.storedOffer,
    nowSeconds: expected.nowSeconds,
  });

  // "Valid" = signed by the merchant over terms equal to the stored offer; expiry has its own fact.
  const termsMatchStored = offerTermsEqual(input.offer, expected.storedOffer);
  const merchantSignedBy = sameAddress(await recoverOfferSigner(domain, input.offer, input.merchantSig), expected.merchant);

  let digest: string | null = null;
  try {
    digest = hashTypedData({ domain, types: OFFER_TYPES, primaryType: "Offer", message: toOfferMessage(input.offer) });
  } catch {
    digest = null;
  }
  const consumer = digest
    ? await verifyConsumerPurchaseAuth(domain, input.auth, input.consumerSig, {
        owner: expected.owner,
        agent: expected.agent,
        offerHash: digest,
        nowSeconds: expected.nowSeconds,
      })
    : ({ ok: false, reason: "malformed_message" } as const);

  return {
    merchantSigValid: merchantSignedBy && termsMatchStored,
    expired: !(input.offer.expiresAt > expected.nowSeconds),
    termsMatchStored,
    consumerSigValid: consumer.ok,
    merchantReason: merchant.ok ? null : merchant.reason,
    consumerReason: consumer.ok ? null : consumer.reason,
  };
}

const MALFORMED_FACTS: PurchaseSignatureFacts = {
  merchantSigValid: false,
  expired: true,
  termsMatchStored: false,
  consumerSigValid: false,
  merchantReason: "malformed_message",
  consumerReason: "malformed_message",
};

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null;

/** Same as `purchaseSignatureFacts` logic, but never throws: null or non-object input, or a bad clock, yields failing facts. */
export async function purchaseSignatureFacts(
  domain: TypedDataDomain,
  input: PurchaseSignatureInput,
  expected: PurchaseExpectation,
): Promise<PurchaseSignatureFacts> {
  if (!isObject(input) || !isObject(input.offer) || !isObject(input.auth) || !isObject(expected) || !isObject(expected.storedOffer)) {
    return { ...MALFORMED_FACTS };
  }
  if (!Number.isSafeInteger(expected.nowSeconds) || expected.nowSeconds < 0) return { ...MALFORMED_FACTS };
  try {
    return await purchaseSignatureFactsUnchecked(domain, input, expected);
  } catch {
    return { ...MALFORMED_FACTS };
  }
}
