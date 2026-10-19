// Owner: R3 (roles.md).
// Merchant simulator: signed Offers (architecture §24.3, §24.7). Each offer's `merchant` is the
// simulator key's address, so the mock escrow can verify `merchantSig` exactly like the contract.
import { OFFER_TYPES, escrowDomainFromEnv, toOfferMessage, type OfferJson } from "@/src/server/chain/types";
import { merchantAccount } from "./keys";
import { MERCHANT_CATALOGUE } from "./merchants";

const OFFER_VALIDITY_S = 30 * 86_400;

export type SimOffer = {
  merchantId: string;
  name: string;
  escrowSupported: boolean;
  offer: OfferJson;
  merchantSig: `0x${string}`;
  simulated: true;
};

/** Signs one offer per catalogue merchant, valid for 30 days from `now`. */
export async function listOffers(now: Date = new Date(), env: Record<string, string | undefined> = process.env): Promise<SimOffer[]> {
  const account = merchantAccount(env);
  const domain = escrowDomainFromEnv(env);
  const nowS = Math.floor(now.getTime() / 1000);
  return Promise.all(
    MERCHANT_CATALOGUE.map(async (m, i) => {
      const offer: OfferJson = {
        merchant: account.address,
        unitPrice: m.unitPrice,
        units: m.units,
        cancelFeeBps: m.cancelFeeBps,
        expiresAt: nowS + OFFER_VALIDITY_S,
        // Distinct per merchant and per issue time, so two listings never share an offer hash.
        nonce: String(BigInt(nowS) * BigInt(100) + BigInt(i + 1)),
      };
      const merchantSig = await account.signTypedData({
        domain,
        types: OFFER_TYPES,
        primaryType: "Offer",
        message: toOfferMessage(offer),
      });
      return { merchantId: m.id, name: m.name, escrowSupported: m.escrowSupported, offer, merchantSig, simulated: true as const };
    }),
  );
}
