// Owner: R2. Pure purchase signature recovery: no DB, no env. Test-only keys (anvil defaults).

import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import {
  OFFER_TYPES,
  PURCHASE_AUTH_TYPES,
  REDEEM_TYPES,
  escrowDomain,
  offerHash,
  toOfferMessage,
  toPurchaseAuthMessage,
  toRedeemMessage,
  type OfferJson,
  type PurchaseAuthJson,
} from "@/src/server/chain/types";
import {
  offerTermsEqual,
  purchaseSignatureFacts,
  recoverOfferSigner,
  recoverPurchaseAuthSigner,
  verifyConsumerPurchaseAuth,
  verifyMerchantOffer,
} from "./purchase-signature";

// anvil test keys #2, #3, #4, #5; throwaway, never funded
const merchant = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
const consumer = privateKeyToAccount("0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6");
const stranger = privateKeyToAccount("0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a");
const agent = privateKeyToAccount("0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba");

const domain = escrowDomain({ chainId: 84532, escrowAddress: "0x00000000000000000000000000000000000000e5" });
const NOW = 1_800_000_000;

const stored: OfferJson = {
  merchant: merchant.address,
  unitPrice: 10000,
  units: 60,
  cancelFeeBps: 1000,
  expiresAt: NOW + 86_400,
  nonce: "7",
};
const storedHash = offerHash(domain, stored);
const auth: PurchaseAuthJson = { offerHash: storedHash, consumer: consumer.address, agent: agent.address, deadline: NOW + 600 };

const signOffer = (o: OfferJson, acct = merchant) =>
  acct.signTypedData({ domain, types: OFFER_TYPES, primaryType: "Offer", message: toOfferMessage(o) });
const signAuth = (a: PurchaseAuthJson, acct = consumer) =>
  acct.signTypedData({ domain, types: PURCHASE_AUTH_TYPES, primaryType: "PurchaseAuth", message: toPurchaseAuthMessage(a) });

const offerExpect = { merchant: merchant.address, storedOffer: stored, nowSeconds: NOW };
const authExpect = { owner: consumer.address, agent: agent.address, offerHash: storedHash, nowSeconds: NOW };

describe("verifyMerchantOffer", () => {
  it("accepts a valid offer and returns its hash", async () => {
    const r = await verifyMerchantOffer(domain, stored, await signOffer(stored), offerExpect);
    expect(r).toEqual({ ok: true, signer: merchant.address, offerHash: storedHash });
  });

  it("compares the merchant address case-insensitively", async () => {
    const r = await verifyMerchantOffer(domain, stored, await signOffer(stored), { ...offerExpect, merchant: merchant.address.toLowerCase() });
    expect(r.ok).toBe(true);
  });

  it("rejects a signature by someone else as wrong_signer", async () => {
    const r = await verifyMerchantOffer(domain, stored, await signOffer(stored, stranger), offerExpect);
    expect(r).toEqual({ ok: false, reason: "wrong_signer" });
  });

  it.each([
    ["unitPrice", { unitPrice: 1 }],
    ["units", { units: 61 }],
    ["cancelFeeBps", { cancelFeeBps: 0 }],
    ["nonce", { nonce: "8" }],
    ["merchant", { merchant: stranger.address }],
  ] as const)("rejects tampered %s as terms_mismatch even when the tampered offer is signed", async (_f, patch) => {
    const tampered = { ...stored, ...patch };
    const r = await verifyMerchantOffer(domain, tampered, await signOffer(tampered), offerExpect);
    expect(r).toEqual({ ok: false, reason: "terms_mismatch" });
  });

  it("rejects stored terms signed by the merchant but presented with another amount (signature over the original)", async () => {
    const sig = await signOffer(stored);
    const r = await verifyMerchantOffer(domain, { ...stored, unitPrice: 20000 }, sig, offerExpect);
    expect(r).toEqual({ ok: false, reason: "terms_mismatch" });
  });

  it("rejects an expired offer and treats expiresAt == now as expired", async () => {
    const old = { ...stored, expiresAt: NOW - 1 };
    const r = await verifyMerchantOffer(domain, old, await signOffer(old), { ...offerExpect, storedOffer: old });
    expect(r).toEqual({ ok: false, reason: "offer_expired" });
    const edge = { ...stored, expiresAt: NOW };
    const e = await verifyMerchantOffer(domain, edge, await signOffer(edge), { ...offerExpect, storedOffer: edge });
    expect(e).toEqual({ ok: false, reason: "offer_expired" });
  });

  it("rejects a signature over the wrong struct type", async () => {
    const wrong = await merchant.signTypedData({
      domain,
      types: REDEEM_TYPES,
      primaryType: "Redeem",
      message: toRedeemMessage({ planId: "1", sessionNo: 1, deadline: NOW + 60 }),
    });
    expect(await verifyMerchantOffer(domain, stored, wrong, offerExpect)).toEqual({ ok: false, reason: "wrong_signer" });
  });

  it("rejects a signature from another chain's domain", async () => {
    const other = escrowDomain({ chainId: 1, escrowAddress: "0x00000000000000000000000000000000000000e5" });
    const sig = await merchant.signTypedData({ domain: other, types: OFFER_TYPES, primaryType: "Offer", message: toOfferMessage(stored) });
    expect(await verifyMerchantOffer(domain, stored, sig, offerExpect)).toEqual({ ok: false, reason: "wrong_signer" });
  });

  it.each(["", "0x", "0x1234", `0x${"zz".repeat(65)}`, `0x${"00".repeat(65)}`, `${"ab".repeat(65)}`])("rejects malformed signature %j", async (sig) => {
    expect(await verifyMerchantOffer(domain, stored, sig, offerExpect)).toEqual({ ok: false, reason: "malformed_signature" });
  });

  it("rejects an unparsable message", async () => {
    const bad = { ...stored, nonce: "not-a-number" };
    expect(await verifyMerchantOffer(domain, bad, await signOffer(stored), offerExpect)).toEqual({ ok: false, reason: "malformed_message" });
  });
});

describe("verifyConsumerPurchaseAuth", () => {
  it("accepts a valid authorisation", async () => {
    const r = await verifyConsumerPurchaseAuth(domain, auth, await signAuth(auth), authExpect);
    expect(r).toEqual({ ok: true, signer: consumer.address });
  });

  it("skips the agent check when no agent is expected", async () => {
    const noAgent = { owner: authExpect.owner, offerHash: authExpect.offerHash, nowSeconds: authExpect.nowSeconds };
    expect((await verifyConsumerPurchaseAuth(domain, auth, await signAuth(auth), noAgent)).ok).toBe(true);
  });

  it("rejects a signature by someone else as wrong_signer", async () => {
    const r = await verifyConsumerPurchaseAuth(domain, auth, await signAuth(auth, stranger), authExpect);
    expect(r).toEqual({ ok: false, reason: "wrong_signer" });
  });

  it("rejects an authorisation bound to a different offer hash", async () => {
    const other = { ...auth, offerHash: offerHash(domain, { ...stored, unitPrice: 1 }) };
    const r = await verifyConsumerPurchaseAuth(domain, other, await signAuth(other), authExpect);
    expect(r).toEqual({ ok: false, reason: "offer_hash_mismatch" });
  });

  it("rejects an authorisation naming another consumer or agent", async () => {
    const c = { ...auth, consumer: stranger.address };
    expect(await verifyConsumerPurchaseAuth(domain, c, await signAuth(c, stranger), authExpect)).toEqual({ ok: false, reason: "consumer_mismatch" });
    const a = { ...auth, agent: stranger.address };
    expect(await verifyConsumerPurchaseAuth(domain, a, await signAuth(a), authExpect)).toEqual({ ok: false, reason: "agent_mismatch" });
  });

  it("rejects a past deadline, including deadline == now", async () => {
    for (const deadline of [NOW - 1, NOW]) {
      const a = { ...auth, deadline };
      expect(await verifyConsumerPurchaseAuth(domain, a, await signAuth(a), authExpect)).toEqual({ ok: false, reason: "deadline_expired" });
    }
  });

  it("rejects a tampered deadline (signature no longer matches)", async () => {
    const sig = await signAuth({ ...auth, deadline: NOW - 100 });
    expect(await verifyConsumerPurchaseAuth(domain, auth, sig, authExpect)).toEqual({ ok: false, reason: "wrong_signer" });
  });

  it("rejects a signature over the wrong struct type", async () => {
    const wrong = await consumer.signTypedData({
      domain,
      types: OFFER_TYPES,
      primaryType: "Offer",
      message: toOfferMessage(stored),
    });
    expect(await verifyConsumerPurchaseAuth(domain, auth, wrong, authExpect)).toEqual({ ok: false, reason: "wrong_signer" });
  });

  it.each(["", "0xabcd", `0x${"00".repeat(65)}`, `0x${"gg".repeat(65)}`])("rejects malformed signature %j", async (sig) => {
    expect(await verifyConsumerPurchaseAuth(domain, auth, sig, authExpect)).toEqual({ ok: false, reason: "malformed_signature" });
  });
});

describe("recover helpers", () => {
  it("return the signer, or null when unparsable", async () => {
    expect(await recoverOfferSigner(domain, stored, await signOffer(stored))).toBe(merchant.address);
    expect(await recoverPurchaseAuthSigner(domain, auth, await signAuth(auth))).toBe(consumer.address);
    expect(await recoverOfferSigner(domain, stored, "0x12")).toBeNull();
    expect(await recoverPurchaseAuthSigner(domain, auth, "nope")).toBeNull();
  });
});

describe("offerTermsEqual", () => {
  it("treats nonce strings numerically and addresses case-insensitively", () => {
    expect(offerTermsEqual(stored, { ...stored, nonce: "007", merchant: stored.merchant.toLowerCase() })).toBe(true);
    expect(offerTermsEqual(stored, { ...stored, nonce: "x" })).toBe(false);
  });
});

describe("purchaseSignatureFacts", () => {
  const input = async () => ({
    offer: stored,
    merchantSig: await signOffer(stored),
    auth,
    consumerSig: await signAuth(auth),
  });
  const expected = { owner: consumer.address, merchant: merchant.address, agent: agent.address, storedOffer: stored, nowSeconds: NOW };

  it("maps a valid purchase to all-good facts", async () => {
    expect(await purchaseSignatureFacts(domain, await input(), expected)).toEqual({
      merchantSigValid: true,
      expired: false,
      termsMatchStored: true,
      consumerSigValid: true,
      merchantReason: null,
      consumerReason: null,
    });
  });

  it("reports an expired offer without invalidating the signature", async () => {
    const old = { ...stored, expiresAt: NOW - 5 };
    const f = await purchaseSignatureFacts(
      domain,
      { offer: old, merchantSig: await signOffer(old), auth: { ...auth, offerHash: offerHash(domain, old) }, consumerSig: await signAuth({ ...auth, offerHash: offerHash(domain, old) }) },
      { ...expected, storedOffer: old },
    );
    expect(f).toMatchObject({ merchantSigValid: true, expired: true, termsMatchStored: true, consumerSigValid: true, merchantReason: "offer_expired" });
  });

  it("reports tampered terms: stored mismatch, merchant signature over other terms does not count", async () => {
    const t = { ...stored, unitPrice: 1 };
    const tAuth = { ...auth, offerHash: offerHash(domain, t) };
    const f = await purchaseSignatureFacts(domain, { offer: t, merchantSig: await signOffer(t), auth: tAuth, consumerSig: await signAuth(tAuth) }, expected);
    expect(f).toMatchObject({ termsMatchStored: false, merchantSigValid: false, merchantReason: "terms_mismatch" });
  });

  it("reports a forged merchant signature and a forged consumer signature", async () => {
    const f = await purchaseSignatureFacts(
      domain,
      { offer: stored, merchantSig: await signOffer(stored, stranger), auth, consumerSig: await signAuth(auth, stranger) },
      expected,
    );
    expect(f).toMatchObject({ merchantSigValid: false, merchantReason: "wrong_signer", consumerSigValid: false, consumerReason: "wrong_signer" });
  });

  it("reports malformed input without throwing", async () => {
    const f = await purchaseSignatureFacts(domain, { offer: { ...stored, nonce: "?" }, merchantSig: "0x", auth, consumerSig: "0x" }, expected);
    expect(f).toMatchObject({ merchantSigValid: false, consumerSigValid: false, termsMatchStored: false, consumerReason: "malformed_message" });
  });
});
