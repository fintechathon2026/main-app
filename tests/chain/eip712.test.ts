// Cross-language parity (PRD_PrepaidEscrow_Contract §8.4, CG4): every struct the TypeScript side
// signs hashes to the same digest the deployed contract computes. Runs on a private anvil.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashTypedData, keccak256, recoverAddress, recoverTypedDataAddress, toHex, type Address, type Hex } from "viem";
import { anvil } from "viem/chains";
import { PREPAID_ESCROW_ABI } from "@/src/server/chain/abi";
import {
  ATTESTATION_PRIMARY_TYPE,
  ATTESTATION_TYPES,
  OFFER_TYPES,
  PURCHASE_AUTH_TYPES,
  REDEEM_TYPES,
  VOLUNTARY_EXIT_TYPES,
  escrowDomain,
} from "@/src/server/chain/eip712";
import { attestationDomain } from "@/src/sim/registry/eip712";
import { currentOffers, signCheckin } from "@/src/sim/merchant/merchant";
import { ADDR, CHAIN_ENABLED, KEYS, startChain, type Chain } from "./anvil";

describe.skipIf(!CHAIN_ENABLED)("chain: EIP-712 parity with PrepaidEscrow", () => {
  let chain: Chain;
  const read = (functionName: string, args: readonly unknown[]) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic view call
    chain.client.readContract({ address: chain.escrow, abi: PREPAID_ESCROW_ABI, functionName, args } as any) as Promise<Hex>;

  beforeAll(async () => {
    chain = await startChain();
  }, 30_000);
  afterAll(async () => {
    await chain?.stop();
  });

  const domain = () => escrowDomain({ chainId: anvil.id, escrowAddress: chain.escrow });

  it("Offer", async () => {
    const offer = { merchant: ADDR.merchant, unitPrice: BigInt(10_000), units: 60, cancelFeeBps: 1000, expiresAt: BigInt(1_900_000_000), nonce: BigInt(7) };
    expect(await read("hashOffer", [offer])).toBe(hashTypedData({ domain: domain(), types: OFFER_TYPES, primaryType: "Offer", message: offer }));
  });

  it("PurchaseAuth", async () => {
    const auth = { offerHash: keccak256(toHex("offer")), consumer: ADDR.consumer, agent: ADDR.agent, deadline: BigInt(1_900_000_000) };
    expect(await read("hashPurchaseAuth", [auth])).toBe(
      hashTypedData({ domain: domain(), types: PURCHASE_AUTH_TYPES, primaryType: "PurchaseAuth", message: auth }),
    );
  });

  it("Redeem and VoluntaryExit", async () => {
    const r = { planId: BigInt(3), sessionNo: 13, deadline: BigInt(1_900_000_000) };
    expect(await read("hashRedeem", [r.planId, r.sessionNo, r.deadline])).toBe(
      hashTypedData({ domain: domain(), types: REDEEM_TYPES, primaryType: "Redeem", message: r }),
    );
    const x = { planId: BigInt(3), deadline: BigInt(1_900_000_000) };
    expect(await read("hashVoluntaryExit", [x.planId, x.deadline])).toBe(
      hashTypedData({ domain: domain(), types: VOLUNTARY_EXIT_TYPES, primaryType: "VoluntaryExit", message: x }),
    );
  });

  it("Attestation as the registry simulator and the Gate define it", async () => {
    const att = { merchant: ADDR.merchant, kind: 1, caseRef: keccak256(toHex("case")), issuedAt: BigInt(1), expiresAt: BigInt(2) };
    const regDomain = attestationDomain({ chainId: anvil.id, escrowAddress: chain.escrow });
    expect(await read("hashAttestation", [att])).toBe(
      hashTypedData({ domain: regDomain, types: ATTESTATION_TYPES, primaryType: ATTESTATION_PRIMARY_TYPE, message: att }),
    );
  });

  it("the merchant simulator's offer hash and signature are what the contract checks", async () => {
    const env = { MERCHANT_SIM_PRIVATE_KEY: KEYS.merchant, CHAIN_ID: String(anvil.id), ESCROW_ADDRESS: chain.escrow };
    const offers = await currentOffers({ env });
    const fitbox = offers.find((o) => o.merchantId === "FITBOX_FUTIAN")!;
    expect(fitbox.offer.merchant).toBe(ADDR.merchant); // follows the merchant key (§7.7)
    const msg = { ...fitbox.offer, merchant: fitbox.offer.merchant as Address, unitPrice: BigInt(fitbox.offer.unitPrice), expiresAt: BigInt(fitbox.offer.expiresAt), nonce: BigInt(fitbox.offer.nonce) };
    expect(await read("hashOffer", [msg])).toBe(fitbox.offerHash);
    const signer = await recoverTypedDataAddress({ domain: domain(), types: OFFER_TYPES, primaryType: "Offer", message: msg, signature: fitbox.merchantSig! });
    expect(signer).toBe(ADDR.merchant);
    // A merchant without escrow support publishes terms only.
    const iron = offers.find((o) => o.merchantId === "IRONPULSE_NANSHAN")!;
    expect(iron.escrowSupported).toBe(false);
    expect(iron.merchantSig).toBeNull();
  });

  it("the gym tablet signs the next session read from the chain, and only for its own active plans", async () => {
    const env = { MERCHANT_SIM_PRIVATE_KEY: KEYS.merchant, CHAIN_ID: String(anvil.id), ESCROW_ADDRESS: chain.escrow };
    const c = await signCheckin({
      planId: BigInt(5),
      env,
      readPlan: async () => ({ merchant: ADDR.merchant, status: "active", units: 60, redeemed: 12 }),
    });
    expect(c.sessionNo).toBe(13);
    const digest = await read("hashRedeem", [BigInt(5), 13, BigInt(c.deadline)]);
    expect(await recoverAddress({ hash: digest, signature: c.merchantSig })).toBe(ADDR.merchant);

    await expect(
      signCheckin({ planId: BigInt(5), env, readPlan: async () => ({ merchant: ADDR.consumer, status: "active", units: 60, redeemed: 0 }) }),
    ).rejects.toThrow("not this merchant's plan");
    await expect(
      signCheckin({ planId: BigInt(5), env, readPlan: async () => ({ merchant: ADDR.merchant, status: "exited_attested", units: 60, redeemed: 0 }) }),
    ).rejects.toThrow("plan not active");
  });
});
