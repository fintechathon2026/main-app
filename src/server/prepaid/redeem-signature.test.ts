// Owner: R2. Pure check-in (redeem) signature recovery: no DB, no env. Test-only keys (anvil defaults).

import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { OFFER_TYPES, REDEEM_TYPES, VOLUNTARY_EXIT_TYPES, escrowDomain, toOfferMessage, toRedeemMessage, toVoluntaryExitMessage, type RedeemJson } from "@/src/server/chain/types";
import { recoverRedeemSigner, verifyRedeemSignatures } from "./redeem-signature";

// anvil test keys #2, #3, #4; throwaway, never funded
const merchant = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
const consumer = privateKeyToAccount("0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6");
const stranger = privateKeyToAccount("0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a");

const domain = escrowDomain({ chainId: 84532, escrowAddress: "0x00000000000000000000000000000000000000e5" });
const NOW = 1_800_000_000;
const redeem: RedeemJson = { planId: "1001", sessionNo: 4, deadline: NOW + 600 };
const expected = { chainPlanId: "1001", sessionNo: 4, owner: consumer.address, merchant: merchant.address, nowSeconds: NOW };

const sign = (r: RedeemJson, acct: typeof consumer) =>
  acct.signTypedData({ domain, types: REDEEM_TYPES, primaryType: "Redeem", message: toRedeemMessage(r) });
// Malleable twin of a valid signature: s -> n - s, v flipped. ecrecover accepts it, OpenZeppelin ECDSA does not.
const SECP_N = BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141");
const highS = (sig: string) => {
  const s = SECP_N - BigInt(`0x${sig.slice(66, 130)}`);
  const v = parseInt(sig.slice(130, 132), 16) === 27 ? 28 : 27;
  return `${sig.slice(0, 66)}${s.toString(16).padStart(64, "0")}${v.toString(16)}`;
};
const withV = (sig: string, v: string) => `${sig.slice(0, 130)}${v}`;

const good = async (r = redeem) => ({ redeem: r, consumerSig: await sign(r, consumer), merchantSig: await sign(r, merchant) });

describe("verifyRedeemSignatures", () => {
  it("accepts two valid distinct signatures", async () => {
    expect(await verifyRedeemSignatures(domain, await good(), expected)).toEqual({
      ok: true,
      consumerSigValid: true,
      merchantSigValid: true,
      sessionNo: 4,
      consumer: consumer.address,
      merchant: merchant.address,
    });
  });

  it("compares addresses case-insensitively", async () => {
    const r = await verifyRedeemSignatures(domain, await good(), { ...expected, owner: consumer.address.toLowerCase(), merchant: merchant.address.toUpperCase().replace("0X", "0x") });
    expect(r.ok).toBe(true);
  });

  it("rejects a wrong consumer signer and still reports the merchant signature", async () => {
    const r = await verifyRedeemSignatures(domain, { ...(await good()), consumerSig: await sign(redeem, stranger) }, expected);
    expect(r).toEqual({ ok: false, reason: "consumer_wrong_signer", consumerSigValid: false, merchantSigValid: true });
  });

  it("rejects a wrong merchant signer", async () => {
    const r = await verifyRedeemSignatures(domain, { ...(await good()), merchantSig: await sign(redeem, stranger) }, expected);
    expect(r).toEqual({ ok: false, reason: "merchant_wrong_signer", consumerSigValid: true, merchantSigValid: false });
  });

  it("rejects swapped signatures", async () => {
    const g = await good();
    const r = await verifyRedeemSignatures(domain, { ...g, consumerSig: g.merchantSig, merchantSig: g.consumerSig }, expected);
    expect(r).toMatchObject({ ok: false, reason: "consumer_wrong_signer" });
  });

  it("rejects a check-in signed only by the consumer (single signature used twice)", async () => {
    const c = await sign(redeem, consumer);
    const r = await verifyRedeemSignatures(domain, { redeem, consumerSig: c, merchantSig: c }, expected);
    expect(r).toEqual({ ok: false, reason: "merchant_wrong_signer", consumerSigValid: true, merchantSigValid: false });
  });

  it("rejects a check-in signed only by the merchant", async () => {
    const m = await sign(redeem, merchant);
    const r = await verifyRedeemSignatures(domain, { redeem, consumerSig: m, merchantSig: m }, expected);
    expect(r).toEqual({ ok: false, reason: "consumer_wrong_signer", consumerSigValid: false, merchantSigValid: true });
  });

  it("requires two distinct expected signers", async () => {
    const same = { ...expected, merchant: consumer.address };
    const c = await sign(redeem, consumer);
    expect(await verifyRedeemSignatures(domain, { redeem, consumerSig: c, merchantSig: c }, same)).toEqual({
      ok: false,
      reason: "signers_not_distinct",
      consumerSigValid: false,
      merchantSigValid: false,
    });
    expect(await verifyRedeemSignatures(domain, await good(), { ...expected, owner: "0x1234" })).toMatchObject({ ok: false, reason: "signers_not_distinct" });
  });

  it("rejects the wrong plan id", async () => {
    const r = await verifyRedeemSignatures(domain, await good({ ...redeem, planId: "1002" }), expected);
    expect(r).toEqual({ ok: false, reason: "plan_id_mismatch", consumerSigValid: false, merchantSigValid: false });
  });

  it("rejects the wrong session number, both too low and too high", async () => {
    for (const sessionNo of [3, 5]) {
      const r = await verifyRedeemSignatures(domain, await good({ ...redeem, sessionNo }), expected);
      expect(r).toMatchObject({ ok: false, reason: "session_mismatch" });
    }
  });

  it("rejects signatures made for session 4 but presented as session 5 (tampered session)", async () => {
    const g = await good();
    const r = await verifyRedeemSignatures(domain, { ...g, redeem: { ...redeem, sessionNo: 5 } }, { ...expected, sessionNo: 5 });
    expect(r).toMatchObject({ ok: false, reason: "consumer_wrong_signer" });
  });

  it("rejects signatures presented with a tampered deadline", async () => {
    const g = await good();
    const r = await verifyRedeemSignatures(domain, { ...g, redeem: { ...redeem, deadline: NOW + 999_999 } }, expected);
    expect(r).toMatchObject({ ok: false, reason: "consumer_wrong_signer" });
  });

  it("rejects an expired check-in, including deadline == now", async () => {
    for (const deadline of [NOW - 1, NOW]) {
      const r = await verifyRedeemSignatures(domain, await good({ ...redeem, deadline }), expected);
      expect(r).toMatchObject({ ok: false, reason: "deadline_expired" });
    }
  });

  it("rejects signatures over the wrong struct type", async () => {
    const exit = (acct: typeof consumer) =>
      acct.signTypedData({ domain, types: VOLUNTARY_EXIT_TYPES, primaryType: "VoluntaryExit", message: toVoluntaryExitMessage({ planId: "1001", deadline: redeem.deadline }) });
    const r = await verifyRedeemSignatures(domain, { redeem, consumerSig: await exit(consumer), merchantSig: await exit(merchant) }, expected);
    expect(r).toMatchObject({ ok: false, reason: "consumer_wrong_signer", consumerSigValid: false, merchantSigValid: false });
    const offerSig = await consumer.signTypedData({
      domain,
      types: OFFER_TYPES,
      primaryType: "Offer",
      message: toOfferMessage({ merchant: merchant.address, unitPrice: 1, units: 1, cancelFeeBps: 0, expiresAt: NOW + 1, nonce: "1" }),
    });
    expect(await verifyRedeemSignatures(domain, { ...(await good()), consumerSig: offerSig }, expected)).toMatchObject({ ok: false, reason: "consumer_wrong_signer" });
  });

  it("rejects signatures from another domain", async () => {
    const other = escrowDomain({ chainId: 1, escrowAddress: "0x00000000000000000000000000000000000000e5" });
    const s = (acct: typeof consumer) => acct.signTypedData({ domain: other, types: REDEEM_TYPES, primaryType: "Redeem", message: toRedeemMessage(redeem) });
    const r = await verifyRedeemSignatures(domain, { redeem, consumerSig: await s(consumer), merchantSig: await s(merchant) }, expected);
    expect(r).toMatchObject({ ok: false, reason: "consumer_wrong_signer" });
  });

  it.each(["", "0x", "0x1234", `0x${"zz".repeat(65)}`, "ab".repeat(65)])("rejects malformed signature %j", async (bad) => {
    const g = await good();
    expect(await verifyRedeemSignatures(domain, { ...g, consumerSig: bad }, expected)).toEqual({ ok: false, reason: "malformed_signature", consumerSigValid: false, merchantSigValid: false });
    expect(await verifyRedeemSignatures(domain, { ...g, merchantSig: bad }, expected)).toMatchObject({ ok: false, reason: "malformed_signature" });
  });

  it("rejects an unrecoverable (all-zero) signature as malformed", async () => {
    const g = await good();
    const r = await verifyRedeemSignatures(domain, { ...g, merchantSig: `0x${"00".repeat(65)}` }, expected);
    expect(r).toEqual({ ok: false, reason: "malformed_signature", consumerSigValid: true, merchantSigValid: false });
  });

  it("rejects an unparsable message without throwing", async () => {
    const g = await good();
    expect(await verifyRedeemSignatures(domain, { ...g, redeem: { ...redeem, planId: "abc" } }, expected)).toMatchObject({ ok: false, reason: "malformed_message" });
    expect(await verifyRedeemSignatures(domain, g, { ...expected, chainPlanId: "x" })).toMatchObject({ ok: false, reason: "malformed_message" });
  });
});

describe("non-canonical signatures", () => {
  it("rejects a high-s twin for either signature", async () => {
    const g = await good();
    expect(await verifyRedeemSignatures(domain, { ...g, consumerSig: highS(g.consumerSig) }, expected)).toEqual({
      ok: false,
      reason: "malformed_signature",
      consumerSigValid: false,
      merchantSigValid: true,
    });
    expect(await verifyRedeemSignatures(domain, { ...g, merchantSig: highS(g.merchantSig) }, expected)).toMatchObject({ ok: false, reason: "malformed_signature" });
    expect(await recoverRedeemSigner(domain, redeem, highS(g.consumerSig))).toBeNull();
  });

  it.each(["02", "1a", "1d", "ff"])("rejects v = 0x%s", async (v) => {
    const g = await good();
    expect(await verifyRedeemSignatures(domain, { ...g, merchantSig: withV(g.merchantSig, v) }, expected)).toMatchObject({ ok: false, reason: "malformed_signature" });
  });

  it("accepts the raw recovery id (v = 0 or 1) for the same signature", async () => {
    const g = await good();
    const raw = (sig: string) => withV(sig, parseInt(sig.slice(130, 132), 16) === 27 ? "00" : "01");
    const r = await verifyRedeemSignatures(domain, { ...g, consumerSig: raw(g.consumerSig), merchantSig: raw(g.merchantSig) }, expected);
    expect(r.ok).toBe(true);
  });
});

describe("never throws", () => {
  it.each([Number.NaN, -1, 1.5, Number.POSITIVE_INFINITY, "x" as never])("rejects nowSeconds %j as malformed_message", async (now) => {
    expect(await verifyRedeemSignatures(domain, await good(), { ...expected, nowSeconds: now })).toEqual({
      ok: false,
      reason: "malformed_message",
      consumerSigValid: false,
      merchantSigValid: false,
    });
  });

  it("rejects null or undefined input and a null redeem", async () => {
    const g = await good();
    for (const bad of [null, undefined, { ...g, redeem: null }, { ...g, redeem: undefined }]) {
      expect(await verifyRedeemSignatures(domain, bad as never, expected)).toMatchObject({ ok: false, reason: "malformed_message" });
    }
    expect(await verifyRedeemSignatures(domain, g, null as never)).toMatchObject({ ok: false, reason: "malformed_message" });
    expect(await verifyRedeemSignatures(domain, g, { ...expected, owner: null as never })).toMatchObject({ ok: false });
  });
});

describe("recoverRedeemSigner", () => {
  it("returns the signer, or null when unparsable", async () => {
    expect(await recoverRedeemSigner(domain, redeem, await sign(redeem, consumer))).toBe(consumer.address);
    expect(await recoverRedeemSigner(domain, redeem, "0x12")).toBeNull();
    expect(await recoverRedeemSigner(domain, { ...redeem, planId: "?" }, await sign(redeem, consumer))).toBeNull();
  });
});
