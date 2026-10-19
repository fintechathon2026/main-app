// Owner: R3 (roles.md). Escrow EIP-712 types: every struct signs and recovers, and the offer
// hash binds every term. Test-only keys (anvil defaults).

import { describe, expect, it } from "vitest";
import { recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  OFFER_TYPES,
  PURCHASE_AUTH_TYPES,
  REDEEM_TYPES,
  VOLUNTARY_EXIT_TYPES,
  escrowDomain,
  offerHash,
  purchaseAuthDigest,
  toOfferMessage,
  toPurchaseAuthMessage,
  toRedeemMessage,
  toVoluntaryExitMessage,
  type OfferJson,
} from "./types";

// anvil test keys #2 and #3; test-only
const merchant = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
const consumer = privateKeyToAccount("0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6");
const domain = escrowDomain({ chainId: 84532 });

const offer: OfferJson = {
  merchant: merchant.address,
  unitPrice: 10000,
  units: 60,
  cancelFeeBps: 1000,
  expiresAt: 1_900_000_000,
  nonce: "7",
};

describe("escrow eip-712 types", () => {
  it("uses the PrepaidEscrow domain", () => {
    expect(domain).toMatchObject({ name: "PrepaidEscrow", version: "1", chainId: 84532 });
  });

  it("matches the contract type strings", () => {
    const typeString = (name: string, fields: readonly { name: string; type: string }[]) =>
      `${name}(${fields.map((f) => `${f.type} ${f.name}`).join(",")})`;
    expect(typeString("Offer", OFFER_TYPES.Offer)).toBe(
      "Offer(address merchant,uint128 unitPrice,uint32 units,uint16 cancelFeeBps,uint64 expiresAt,uint256 nonce)",
    );
    expect(typeString("PurchaseAuth", PURCHASE_AUTH_TYPES.PurchaseAuth)).toBe(
      "PurchaseAuth(bytes32 offerHash,address consumer,address agent,uint64 deadline)",
    );
    expect(typeString("Redeem", REDEEM_TYPES.Redeem)).toBe("Redeem(uint256 planId,uint32 sessionNo,uint64 deadline)");
    expect(typeString("VoluntaryExit", VOLUNTARY_EXIT_TYPES.VoluntaryExit)).toBe("VoluntaryExit(uint256 planId,uint64 deadline)");
  });

  it("signs and recovers an offer", async () => {
    const message = toOfferMessage(offer);
    const signature = await merchant.signTypedData({ domain, types: OFFER_TYPES, primaryType: "Offer", message });
    expect(await recoverTypedDataAddress({ domain, types: OFFER_TYPES, primaryType: "Offer", message, signature })).toBe(merchant.address);
  });

  it("signs and recovers a purchase authorization bound to the offer hash", async () => {
    const auth = { offerHash: offerHash(domain, offer), consumer: consumer.address, agent: "0xa9e7000000000000000000000000000000000a9e", deadline: 1_900_000_000 };
    const message = toPurchaseAuthMessage(auth);
    const signature = await consumer.signTypedData({ domain, types: PURCHASE_AUTH_TYPES, primaryType: "PurchaseAuth", message });
    expect(await recoverTypedDataAddress({ domain, types: PURCHASE_AUTH_TYPES, primaryType: "PurchaseAuth", message, signature })).toBe(
      consumer.address,
    );
    expect(purchaseAuthDigest(domain, auth)).toMatch(/^0x[0-9a-f]{64}$/);
    expect(purchaseAuthDigest(domain, { ...auth, deadline: auth.deadline + 1 })).not.toBe(purchaseAuthDigest(domain, auth));
  });

  it("signs and recovers a redeem with both parties over the same struct", async () => {
    const message = toRedeemMessage({ planId: "1000", sessionNo: 13, deadline: 1_900_000_000 });
    const args = { domain, types: REDEEM_TYPES, primaryType: "Redeem", message } as const;
    const cSig = await consumer.signTypedData(args);
    const mSig = await merchant.signTypedData(args);
    expect(await recoverTypedDataAddress({ ...args, signature: cSig })).toBe(consumer.address);
    expect(await recoverTypedDataAddress({ ...args, signature: mSig })).toBe(merchant.address);
  });

  it("signs and recovers a voluntary exit", async () => {
    const message = toVoluntaryExitMessage({ planId: "1000", deadline: 1_900_000_000 });
    const args = { domain, types: VOLUNTARY_EXIT_TYPES, primaryType: "VoluntaryExit", message } as const;
    const signature = await consumer.signTypedData(args);
    expect(await recoverTypedDataAddress({ ...args, signature })).toBe(consumer.address);
  });

  it("offer hash changes when any term or the domain changes", () => {
    const base = offerHash(domain, offer);
    expect(offerHash(domain, { ...offer })).toBe(base);
    const variants: OfferJson[] = [
      { ...offer, merchant: consumer.address },
      { ...offer, unitPrice: offer.unitPrice + 1 },
      { ...offer, units: offer.units - 1 },
      { ...offer, cancelFeeBps: offer.cancelFeeBps + 1 },
      { ...offer, expiresAt: offer.expiresAt + 1 },
      { ...offer, nonce: "8" },
    ];
    for (const v of variants) expect(offerHash(domain, v)).not.toBe(base);
    expect(offerHash(escrowDomain({ chainId: 1 }), offer)).not.toBe(base);
    expect(offerHash(escrowDomain({ chainId: 84532, escrowAddress: consumer.address }), offer)).not.toBe(base);
  });
});
