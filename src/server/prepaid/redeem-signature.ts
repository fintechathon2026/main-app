// Owner: R2 (roles.md). Pure signature checks for a prepaid check-in, i.e. `redeem` (architecture
// §24.3, §24.9, ADR-012). A session needs TWO signatures over the same EIP-712
// Redeem(planId, sessionNo, deadline): the consumer's (browser key) and the merchant's (the
// gym's check-in). This module only RECOVERS the signer addresses and compares them with the
// plan owner and merchant the caller read from our own rows or the contract. It signs nothing,
// holds no key, reads no env, no clock and no database: `domain` and `nowSeconds` are injected
// (G2, G9/G10). The contract re-checks everything. Never log signatures.
//
// Wiring (owner of snapshot.ts, not done here). Phase A, for `prepaid_redeem`, call
// `verifyRedeemSignatures(...)` and fill:
//   prepaid.consumerSigValid <- result.consumerSigValid
//   prepaid.merchantSigValid <- result.merchantSigValid
//   prepaid.sessionNo        <- the redeem.sessionNo that was signed (the Gate compares it with plan.nextSession)
// `prepaid.plan.owner/merchant/nextSession` come from the contract read, and are what this module
// is given as `expected`. Pass `escrowDomainFromEnv()` as `domain` and the executor clock as `nowSeconds`.

import { recoverTypedDataAddress, type Hex, type TypedDataDomain } from "viem";
import { REDEEM_TYPES, toRedeemMessage, type RedeemJson } from "@/src/server/chain/types";

/** Stable reason strings. */
export type RedeemSignatureReason =
  | "signers_not_distinct"
  | "malformed_signature"
  | "malformed_message"
  | "plan_id_mismatch"
  | "session_mismatch"
  | "deadline_expired"
  | "consumer_wrong_signer"
  | "merchant_wrong_signer";

export type RedeemSignatureResult =
  | { ok: true; consumerSigValid: true; merchantSigValid: true; sessionNo: number; consumer: string; merchant: string }
  | { ok: false; reason: RedeemSignatureReason; consumerSigValid: boolean; merchantSigValid: boolean };

export type RedeemSignatureInput = {
  redeem: RedeemJson;
  consumerSig: string;
  merchantSig: string;
};

export type RedeemExpectation = {
  /** Escrow plan id (public.prepaid_plans.chain_plan_id), decimal string. */
  chainPlanId: string;
  /** The session the plan expects next (contract `redeemed + 1`). */
  sessionNo: number;
  /** plan.owner: the user's consumer_browser wallet. */
  owner: string;
  /** plan.merchant. */
  merchant: string;
  nowSeconds: number;
};

const SIG_RE = /^0x[0-9a-fA-F]{130}$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const sameAddress = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && ADDRESS_RE.test(a) && ADDRESS_RE.test(b) && a.toLowerCase() === b.toLowerCase();

/** Recovers the signer of a Redeem; null when the signature or message cannot be parsed. */
export async function recoverRedeemSigner(domain: TypedDataDomain, redeem: RedeemJson, signature: string): Promise<string | null> {
  if (!SIG_RE.test(signature)) return null;
  try {
    return await recoverTypedDataAddress({
      domain,
      types: REDEEM_TYPES,
      primaryType: "Redeem",
      message: toRedeemMessage(redeem),
      signature: signature as Hex,
    });
  } catch {
    return null;
  }
}

const fail = (reason: RedeemSignatureReason, consumerSigValid = false, merchantSigValid = false): RedeemSignatureResult => ({
  ok: false,
  reason,
  consumerSigValid,
  merchantSigValid,
});

/**
 * Checks a check-in: the message is for `expected.chainPlanId` and `expected.sessionNo`, unexpired
 * at `nowSeconds` (valid while `deadline > now`), and the two signatures recover to the plan owner
 * (consumer) and the plan merchant, which must be two different addresses. On failure the
 * per-signature booleans say which signature recovered to its expected signer for this exact
 * message; they are both false when the message itself is wrong.
 */
export async function verifyRedeemSignatures(
  domain: TypedDataDomain,
  input: RedeemSignatureInput,
  expected: RedeemExpectation,
): Promise<RedeemSignatureResult> {
  if (!ADDRESS_RE.test(expected.owner) || !ADDRESS_RE.test(expected.merchant) || sameAddress(expected.owner, expected.merchant)) {
    return fail("signers_not_distinct");
  }
  if (!SIG_RE.test(input.consumerSig) || !SIG_RE.test(input.merchantSig)) return fail("malformed_signature");

  let planId: bigint;
  let expectedPlanId: bigint;
  let signedDeadline: bigint;
  try {
    planId = BigInt(input.redeem.planId);
    expectedPlanId = BigInt(expected.chainPlanId);
    signedDeadline = BigInt(input.redeem.deadline);
    toRedeemMessage(input.redeem);
  } catch {
    return fail("malformed_message");
  }
  if (planId !== expectedPlanId) return fail("plan_id_mismatch");
  if (input.redeem.sessionNo !== expected.sessionNo) return fail("session_mismatch");
  if (!(signedDeadline > BigInt(expected.nowSeconds))) return fail("deadline_expired");

  const [consumerSigner, merchantSigner] = await Promise.all([
    recoverRedeemSigner(domain, input.redeem, input.consumerSig),
    recoverRedeemSigner(domain, input.redeem, input.merchantSig),
  ]);
  if (consumerSigner === null || merchantSigner === null) {
    return fail("malformed_signature", sameAddress(consumerSigner, expected.owner), sameAddress(merchantSigner, expected.merchant));
  }
  const consumerOk = sameAddress(consumerSigner, expected.owner);
  const merchantOk = sameAddress(merchantSigner, expected.merchant);
  if (!consumerOk) return fail("consumer_wrong_signer", false, merchantOk);
  if (!merchantOk) return fail("merchant_wrong_signer", true, false);
  return { ok: true, consumerSigValid: true, merchantSigValid: true, sessionNo: input.redeem.sessionNo, consumer: consumerSigner, merchant: merchantSigner };
}
