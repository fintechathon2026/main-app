// Owner: R3 (roles.md).
// Signing helpers for mock escrow tests: parties with fresh test keys sign offers, purchase
// authorizations, redeems, voluntary exits and oracle attestations exactly as the browser,
// the merchant simulator and the registry would. Test-only keys; never used outside tests.

import type { Pool } from "pg";
import { expect } from "vitest";
import type { Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import {
  OFFER_TYPES,
  PURCHASE_AUTH_TYPES,
  REDEEM_TYPES,
  VOLUNTARY_EXIT_TYPES,
  escrowDomainFromEnv,
  offerHash,
  toOfferMessage,
  toPurchaseAuthMessage,
  toRedeemMessage,
  toVoluntaryExitMessage,
  type OfferJson,
  type PurchaseAuthJson,
} from "@/src/server/chain/types";
import { ATTESTATION_PRIMARY_TYPE, ATTESTATION_TYPES, toAttestationMessage, type AttestationJson } from "@/src/sim/registry/eip712";
import { TEST_ORACLE_KEY, caseRefFor } from "./attestations";

export const nowS = () => Math.floor(Date.now() / 1000);

export type Parties = { consumer: PrivateKeyAccount; merchant: PrivateKeyAccount; agent: PrivateKeyAccount };

export const newAccount = () => privateKeyToAccount(generatePrivateKey());

export function newParties(): Parties {
  return { consumer: newAccount(), merchant: newAccount(), agent: newAccount() };
}

export type PurchaseBody = { offer: OfferJson; merchantSig: string; auth: PurchaseAuthJson; consumerSig: string; permit?: unknown };

/**
 * A signed purchase. `offer`/`auth` override terms BEFORE signing; `merchantSigner`/`consumerSigner`
 * sign with another key (forgery); `authOfferHash` replaces the bound offer hash before signing.
 */
export async function signPurchase(
  p: Parties,
  o: {
    offer?: Partial<OfferJson>;
    auth?: Partial<PurchaseAuthJson>;
    merchantSigner?: PrivateKeyAccount;
    consumerSigner?: PrivateKeyAccount;
    authOfferHash?: Hex;
  } = {},
): Promise<PurchaseBody> {
  const domain = escrowDomainFromEnv();
  const offer: OfferJson = {
    merchant: p.merchant.address,
    unitPrice: 10000,
    units: 10,
    cancelFeeBps: 1000,
    expiresAt: nowS() + 3600,
    nonce: String(BigInt(Date.now()) * BigInt(1000) + BigInt(Math.floor(Math.random() * 1000))),
    ...o.offer,
  };
  const merchantSig = await (o.merchantSigner ?? p.merchant).signTypedData({
    domain,
    types: OFFER_TYPES,
    primaryType: "Offer",
    message: toOfferMessage(offer),
  });
  const auth: PurchaseAuthJson = {
    offerHash: o.authOfferHash ?? offerHash(domain, offer),
    consumer: p.consumer.address,
    agent: p.agent.address,
    deadline: nowS() + 600,
    ...o.auth,
  };
  const consumerSig = await (o.consumerSigner ?? p.consumer).signTypedData({
    domain,
    types: PURCHASE_AUTH_TYPES,
    primaryType: "PurchaseAuth",
    message: toPurchaseAuthMessage(auth),
  });
  return { offer, merchantSig, auth, consumerSig };
}

export async function signRedeem(signer: PrivateKeyAccount, planId: string, sessionNo: number, deadline: number): Promise<Hex> {
  return signer.signTypedData({
    domain: escrowDomainFromEnv(),
    types: REDEEM_TYPES,
    primaryType: "Redeem",
    message: toRedeemMessage({ planId, sessionNo, deadline }),
  });
}

/** Both parties sign the same Redeem (the check-in flow). */
export async function redeemBody(p: Parties, planId: string, sessionNo: number, deadline = nowS() + 600) {
  return {
    sessionNo,
    deadline,
    consumerSig: await signRedeem(p.consumer, planId, sessionNo, deadline),
    merchantSig: await signRedeem(p.merchant, planId, sessionNo, deadline),
  };
}

export async function signVoluntaryExit(signer: PrivateKeyAccount, planId: string, deadline: number): Promise<Hex> {
  return signer.signTypedData({
    domain: escrowDomainFromEnv(),
    types: VOLUNTARY_EXIT_TYPES,
    primaryType: "VoluntaryExit",
    message: toVoluntaryExitMessage({ planId, deadline }),
  });
}

/** An oracle-signed attestation in the registry's wire format (no DB row). */
export async function signAttestationWire(o: {
  merchant: string;
  kind?: number;
  issuedAt?: number;
  expiresAt?: number;
  signerKey?: Hex;
  caseLabel?: string;
}): Promise<AttestationJson> {
  const issuedAt = o.issuedAt ?? nowS() - 3600;
  const wire = {
    merchant: o.merchant,
    kind: o.kind ?? 1,
    caseRef: caseRefFor(o.caseLabel ?? `case:${issuedAt}:${Math.random()}`),
    issuedAt,
    expiresAt: o.expiresAt ?? issuedAt + 7 * 86_400,
  };
  const signature = await privateKeyToAccount(o.signerKey ?? TEST_ORACLE_KEY).signTypedData({
    domain: escrowDomainFromEnv(),
    types: ATTESTATION_TYPES,
    primaryType: ATTESTATION_PRIMARY_TYPE,
    // The contract types kind as uint8; out-of-range kinds are signed as-is to test the kind check.
    message: toAttestationMessage({ ...wire, kind: wire.kind as 1 | 2 }),
  });
  return { ...wire, signature, simulated: true };
}

/**
 * G9/G10 for one plan: every fen that left it went to the plan's merchant (role merchant) or
 * owner (role consumer), and payouts plus the remaining balance equal what was paid in.
 */
export async function expectPlanInvariant(admin: Pool, chainPlanId: string) {
  const p = (
    await admin.query(
      `select owner, merchant, unit_price::text as unit_price, units_total, units_redeemed, status, balance::text as balance
         from mockbank.escrow_plans where chain_plan_id = $1`,
      [chainPlanId],
    )
  ).rows[0];
  const payouts = (
    await admin.query("select to_address, role, amount::text as amount, reason from mockbank.escrow_payouts where chain_plan_id = $1", [
      chainPlanId,
    ])
  ).rows as { to_address: string; role: string; amount: string; reason: string }[];
  const paid = payouts.reduce((s, x) => s + BigInt(x.amount), BigInt(0));
  expect(paid + BigInt(p.balance)).toBe(BigInt(p.unit_price) * BigInt(p.units_total));
  for (const x of payouts) {
    const expected = x.role === "merchant" ? p.merchant : p.owner;
    expect(x.to_address.toLowerCase()).toBe(String(expected).toLowerCase());
    expect([p.merchant.toLowerCase(), p.owner.toLowerCase()]).toContain(x.to_address.toLowerCase());
  }
  const redeemed = payouts.filter((x) => x.reason === "redeem");
  expect(redeemed.length).toBe(p.units_redeemed);
  for (const x of redeemed) expect(BigInt(x.amount)).toBe(BigInt(p.unit_price));
  if (p.status === "active") expect(BigInt(p.balance)).toBe(BigInt(p.unit_price) * BigInt(p.units_total - p.units_redeemed));
  else expect(p.balance).toBe("0");
  return { plan: p, payouts };
}
