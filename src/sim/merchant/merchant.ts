// Owner: R3 (roles.md).
// Merchant simulator, chain flavour (PRD_PrepaidEscrow_Contract §7.7, architecture §24.7): bigint
// offers and check-ins for scripts/chain-demo-setup and the anvil parity tests. The HTTP routes use
// offers.ts / checkin.ts. The key is read only in keys.ts. It is an outside party: it reads the
// chain itself and imports nothing from the executor, agent or adapters.

import type { Address, Hex } from "viem";
import { hashTypedData } from "viem";
import { OFFER_TYPES, REDEEM_TYPES, escrowDomain, type OfferMessage } from "@/src/server/chain/eip712";
import { ESCROW_MERCHANT_ID, SIM_MERCHANTS, simMerchantAddress } from "../registry/merchants";
import { MerchantKeyMissing, merchantAccount } from "./keys";

export { MerchantKeyMissing, merchantAccount };

type Env = Record<string, string | undefined>;

/** Terms per merchant, mirroring the seeded prepaid_offers (amounts in fen). */
const TERMS: Record<string, { unitPrice: number; units: number; cancelFeeBps: number; payPerVisit: number; escrow: boolean }> = {
  FITBOX_FUTIAN: { unitPrice: 10_000, units: 60, cancelFeeBps: 1000, payPerVisit: 12_500, escrow: true },
  IRONPULSE_NANSHAN: { unitPrice: 8_000, units: 50, cancelFeeBps: 1500, payPerVisit: 10_000, escrow: false },
};

const DAY_S = 86_400;
const OFFER_VALID_DAYS = 30;

export type OfferJson = {
  merchantId: string;
  name: string;
  escrowSupported: boolean;
  payPerVisitPrice: number;
  offer: { merchant: string; unitPrice: number; units: number; cancelFeeBps: number; expiresAt: number; nonce: string };
  offerHash: Hex | null;
  merchantSig: Hex | null;
  simulated: true;
};

/**
 * Current offers. The escrow merchant's offer is EIP-712 signed over the escrow domain
 * (CHAIN_ID, ESCROW_ADDRESS); a merchant without escrow support publishes terms only. The
 * nonce is the validity window's start day, so the same offer is re-issued within a day.
 */
export async function currentOffers(opts: { now?: Date; env?: Env } = {}): Promise<OfferJson[]> {
  const env = opts.env ?? process.env;
  const nowS = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  const day = Math.floor(nowS / DAY_S);
  const domain = escrowDomain({ chainId: env.CHAIN_ID, escrowAddress: env.ESCROW_ADDRESS });
  const out: OfferJson[] = [];
  for (const m of SIM_MERCHANTS) {
    const t = TERMS[m.id];
    if (!t) continue;
    const message: OfferMessage = {
      merchant: simMerchantAddress(m, env),
      unitPrice: BigInt(t.unitPrice),
      units: t.units,
      cancelFeeBps: t.cancelFeeBps,
      expiresAt: BigInt((day + OFFER_VALID_DAYS) * DAY_S),
      nonce: BigInt(day),
    };
    let sig: Hex | null = null;
    let hash: Hex | null = null;
    if (t.escrow && m.id === ESCROW_MERCHANT_ID) {
      const account = merchantAccount(env);
      sig = await account.signTypedData({ domain, types: OFFER_TYPES, primaryType: "Offer", message });
      hash = hashTypedData({ domain, types: OFFER_TYPES, primaryType: "Offer", message });
    }
    out.push({
      merchantId: m.id,
      name: m.name,
      escrowSupported: t.escrow,
      payPerVisitPrice: t.payPerVisit,
      offer: {
        merchant: message.merchant,
        unitPrice: t.unitPrice,
        units: t.units,
        cancelFeeBps: t.cancelFeeBps,
        expiresAt: Number(message.expiresAt),
        nonce: message.nonce.toString(),
      },
      offerHash: hash,
      merchantSig: sig,
      simulated: true,
    });
  }
  return out;
}

/** What the merchant needs to know about a plan to sign a check-in (read from the chain). */
export type PlanView = { merchant: Address; status: string; units: number; redeemed: number };

export type CheckinJson = { planId: string; sessionNo: number; deadline: number; merchantSig: Hex; simulated: true };

export class CheckinRefused extends Error {}

/**
 * The gym tablet: signs Redeem(planId, nextSession, deadline) for an active plan of this
 * merchant. The session number comes from the chain, never from the caller.
 */
export async function signCheckin(input: {
  planId: bigint;
  readPlan: (planId: bigint) => Promise<PlanView | null>;
  now?: Date;
  validSeconds?: number;
  env?: Env;
}): Promise<CheckinJson> {
  const env = input.env ?? process.env;
  const account = merchantAccount(env);
  const plan = await input.readPlan(input.planId);
  if (!plan || plan.status !== "active") throw new CheckinRefused("plan not active");
  if (plan.merchant.toLowerCase() !== account.address.toLowerCase()) throw new CheckinRefused("not this merchant's plan");
  const sessionNo = plan.redeemed + 1;
  const deadline = Math.floor((input.now ?? new Date()).getTime() / 1000) + (input.validSeconds ?? 10 * 60);
  const merchantSig = await account.signTypedData({
    domain: escrowDomain({ chainId: env.CHAIN_ID, escrowAddress: env.ESCROW_ADDRESS }),
    types: REDEEM_TYPES,
    primaryType: "Redeem",
    message: { planId: input.planId, sessionNo, deadline: BigInt(deadline) },
  });
  return { planId: input.planId.toString(), sessionNo, deadline, merchantSig, simulated: true };
}
