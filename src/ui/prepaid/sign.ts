"use client";

// Browser-side EIP-712 signing for prepaid actions (architecture §24.3, §24.10). Same struct
// definitions as the server and the contract (src/server/chain/types.ts, pure, no keys or I/O).
// The domain comes from GET /api/prepaid/signing so signer and verifier always agree.

import { createPublicClient, http, parseSignature, type Address, type Hex, type TypedDataDomain } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import {
  OFFER_TYPES,
  PURCHASE_AUTH_TYPES,
  REDEEM_TYPES,
  VOLUNTARY_EXIT_TYPES,
  offerHash,
  toPurchaseAuthMessage,
  toRedeemMessage,
  toVoluntaryExitMessage,
  type OfferJson,
} from "@/src/server/chain/types";

export type SigningConfig = {
  mode: "mock" | "chain";
  domain: { name: string; version: string; chainId: number; verifyingContract: string };
  token: { address: string; name: string } | null;
  agent: string | null;
  rpcUrl?: string | null;
};

export { OFFER_TYPES };

const domainOf = (c: SigningConfig): TypedDataDomain => ({ ...c.domain, verifyingContract: c.domain.verifyingContract as Address });
const nowS = () => Math.floor(Date.now() / 1000);

const PERMIT_TYPES = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

const NONCES_ABI = [
  { type: "function", name: "nonces", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

/**
 * The user's PurchaseAuth over the merchant's signed offer (and the token permit on chain).
 * `agent` is Reins' agent address, so Reins can exit the plan on an official notice.
 */
export async function signPurchase(
  account: PrivateKeyAccount,
  cfg: SigningConfig,
  offer: OfferJson,
  merchantSig: Hex,
  opts: { readNonce?: (owner: Address) => Promise<bigint> } = {},
) {
  if (!cfg.agent) throw new Error("Reins has no agent address configured.");
  const domain = domainOf(cfg);
  const deadline = nowS() + 15 * 60;
  const auth = { offerHash: offerHash(domain, offer), consumer: account.address, agent: cfg.agent, deadline };
  const consumerSig = await account.signTypedData({ domain, types: PURCHASE_AUTH_TYPES, primaryType: "PurchaseAuth", message: toPurchaseAuthMessage(auth) });

  let permit: { value: string; deadline: string; v: number; r: Hex; s: Hex } | undefined;
  if (cfg.mode === "chain" && cfg.token) {
    const value = BigInt(offer.unitPrice) * BigInt(offer.units);
    const nonce = opts.readNonce ? await opts.readNonce(account.address) : BigInt(0);
    const sig = await account.signTypedData({
      domain: { name: cfg.token.name, version: "1", chainId: cfg.domain.chainId, verifyingContract: cfg.token.address as Address },
      types: PERMIT_TYPES,
      primaryType: "Permit",
      message: { owner: account.address, spender: cfg.domain.verifyingContract as Address, value, nonce, deadline: BigInt(deadline) },
    });
    const { r, s, v, yParity } = parseSignature(sig);
    permit = { value: value.toString(), deadline: String(deadline), v: Number(v ?? BigInt(yParity + 27)), r, s };
  }
  return { offer, merchantSig, auth, consumerSig, ...(permit ? { permit } : {}) };
}

/** Token permit nonce read straight from the chain (public read, no key). */
export function permitNonceReader(rpcUrl: string, token: Address) {
  const client = createPublicClient({ transport: http(rpcUrl) });
  return (owner: Address) => client.readContract({ address: token, abi: NONCES_ABI, functionName: "nonces", args: [owner] });
}

/** The user's half of a check-in: the same Redeem the gym tablet signed. */
export async function signRedeem(account: PrivateKeyAccount, cfg: SigningConfig, r: { planId: string; sessionNo: number; deadline: number }) {
  return account.signTypedData({ domain: domainOf(cfg), types: REDEEM_TYPES, primaryType: "Redeem", message: toRedeemMessage(r) });
}

/** The owner's VoluntaryExit(planId, deadline). */
export async function signVoluntaryExit(account: PrivateKeyAccount, cfg: SigningConfig, planId: string) {
  const deadline = nowS() + 15 * 60;
  const consumerSig = await account.signTypedData({
    domain: domainOf(cfg),
    types: VOLUNTARY_EXIT_TYPES,
    primaryType: "VoluntaryExit",
    message: toVoluntaryExitMessage({ planId, deadline }),
  });
  return { deadline, consumerSig };
}
