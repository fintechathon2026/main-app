// Cross-language parity (PRD_PrepaidEscrow_Contract §8.4, CG4): every struct the TypeScript side
// signs hashes to the same digest the deployed contract computes, and what the simulators sign is
// accepted by the contract. Runs on a private anvil.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { hashTypedData, keccak256, recoverAddress, recoverTypedDataAddress, toHex, type Hex } from "viem";
import { anvil } from "viem/chains";
import { PREPAID_ESCROW_ABI } from "@/src/server/chain/abi";
import {
  OFFER_TYPES,
  REDEEM_TYPES,
  VOLUNTARY_EXIT_TYPES,
  escrowDomain,
  offerHash,
  purchaseAuthDigest,
  toOfferMessage,
  toPurchaseAuthMessage,
  toRedeemMessage,
  toVoluntaryExitMessage,
} from "@/src/server/chain/types";
import { ATTESTATION_PRIMARY_TYPE, ATTESTATION_TYPES, attestationDomain } from "@/src/sim/registry/eip712";
import { SIM_MERCHANTS, simMerchantAddress } from "@/src/sim/registry/merchants";
import { publishAttestation, resetRegistry } from "@/src/sim/registry/attestations";
import { listOffers } from "@/src/sim/merchant/offers";
import { CheckinError, readPlanFromChain, signCheckin } from "@/src/sim/merchant/checkin";
import { ADDR, CHAIN_ENABLED, KEYS, mint, purchaseCallArgs, sendAs, signedPurchase, startChain, type Chain } from "./anvil";

describe.skipIf(!CHAIN_ENABLED)("chain: EIP-712 parity with PrepaidEscrow", () => {
  let chain: Chain;
  const read = (functionName: string, args: readonly unknown[]) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic view call
    chain.client.readContract({ address: chain.escrow, abi: PREPAID_ESCROW_ABI, functionName, args } as any) as Promise<Hex>;

  beforeAll(async () => {
    chain = await startChain();
    await mint(chain, ADDR.consumer, BigInt(10_000_000));
  }, 30_000);
  afterAll(async () => {
    await chain?.stop();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    resetRegistry();
  });

  const domain = () => escrowDomain({ chainId: anvil.id, escrowAddress: chain.escrow });
  const simEnv = () => ({ MERCHANT_SIM_PRIVATE_KEY: KEYS.merchant, ORACLE_PRIVATE_KEY: KEYS.oracle, CHAIN_ID: String(anvil.id), ESCROW_ADDRESS: chain.escrow });
  const lastPlanId = async () =>
    (await chain.client.readContract({ address: chain.escrow, abi: PREPAID_ESCROW_ABI, functionName: "nextPlanId" })) - BigInt(1);

  it("Offer and PurchaseAuth", async () => {
    const offer = { merchant: ADDR.merchant, unitPrice: 10_000, units: 60, cancelFeeBps: 1000, expiresAt: 1_900_000_000, nonce: "7" };
    expect(await read("hashOffer", [toOfferMessage(offer)])).toBe(offerHash(domain(), offer));
    const auth = { offerHash: keccak256(toHex("offer")), consumer: ADDR.consumer, agent: ADDR.agent, deadline: 1_900_000_000 };
    expect(await read("hashPurchaseAuth", [toPurchaseAuthMessage(auth)])).toBe(purchaseAuthDigest(domain(), auth));
  });

  it("Redeem and VoluntaryExit", async () => {
    const m = toRedeemMessage({ planId: "3", sessionNo: 13, deadline: 1_900_000_000 });
    expect(await read("hashRedeem", [m.planId, m.sessionNo, m.deadline])).toBe(
      hashTypedData({ domain: domain(), types: REDEEM_TYPES, primaryType: "Redeem", message: m }),
    );
    const x = toVoluntaryExitMessage({ planId: "3", deadline: 1_900_000_000 });
    expect(await read("hashVoluntaryExit", [x.planId, x.deadline])).toBe(
      hashTypedData({ domain: domain(), types: VOLUNTARY_EXIT_TYPES, primaryType: "VoluntaryExit", message: x }),
    );
  });

  it("Attestation as the registry simulator and the Gate define it", async () => {
    const att = { merchant: ADDR.merchant, kind: 1, caseRef: keccak256(toHex("case")), issuedAt: BigInt(1), expiresAt: BigInt(2) };
    expect(await read("hashAttestation", [att])).toBe(
      hashTypedData({
        domain: attestationDomain({ chainId: anvil.id, escrowAddress: chain.escrow }),
        types: ATTESTATION_TYPES,
        primaryType: ATTESTATION_PRIMARY_TYPE,
        message: att,
      }),
    );
  });

  it("the merchant simulator's offers hash and verify the way the contract does", async () => {
    const offers = await listOffers(new Date(), simEnv());
    const fitbox = offers.find((o) => o.merchantId === "FITBOX_FUTIAN")!;
    expect(fitbox.offer.merchant).toBe(ADDR.merchant);
    expect(await read("hashOffer", [toOfferMessage(fitbox.offer)])).toBe(offerHash(domain(), fitbox.offer));
    const signer = await recoverTypedDataAddress({
      domain: domain(),
      types: OFFER_TYPES,
      primaryType: "Offer",
      message: toOfferMessage(fitbox.offer),
      signature: fitbox.merchantSig,
    });
    expect(signer).toBe(ADDR.merchant);
    expect(offers.find((o) => o.merchantId === "IRONPULSE_NANSHAN")!.escrowSupported).toBe(false);
  });

  it("the gym tablet signs the next session, and only for its own active plans", async () => {
    const reader = (over: Partial<{ merchant: string; status: string; units_redeemed: number }> = {}) => async () => ({
      chain_plan_id: "5",
      merchant: ADDR.merchant as string,
      status: "active",
      units_redeemed: 12,
      ...over,
    });
    const c = await signCheckin("5", new Date(), reader(), simEnv());
    expect(c.sessionNo).toBe(13);
    const digest = await read("hashRedeem", [BigInt(5), 13, BigInt(c.deadline)]);
    expect(await recoverAddress({ hash: digest, signature: c.merchantSig })).toBe(ADDR.merchant);

    await expect(signCheckin("5", new Date(), reader({ merchant: ADDR.consumer }), simEnv())).rejects.toThrow("not_this_merchant");
    await expect(signCheckin("5", new Date(), reader({ status: "exited_attested" }), simEnv())).rejects.toThrow("plan_not_active");
    await expect(signCheckin("5", new Date(), async () => null, simEnv())).rejects.toBeInstanceOf(CheckinError);
  });

  it("with REINS_ESCROW=chain the gym tablet reads the plan from the contract", async () => {
    vi.stubEnv("CHAIN_ID", String(anvil.id));
    vi.stubEnv("ESCROW_ADDRESS", chain.escrow);
    vi.stubEnv("BASE_SEPOLIA_RPC_URL", chain.rpcUrl);
    await sendAs(chain, KEYS.relayer, "purchaseWithPermit", purchaseCallArgs(await signedPurchase(chain, { units: 4 })));
    const id = String(await lastPlanId());

    expect(await readPlanFromChain(id)).toEqual({ chain_plan_id: id, merchant: ADDR.merchant, status: "active", units_redeemed: 0 });
    expect(await readPlanFromChain("999999")).toBeNull();
    expect(await readPlanFromChain("not-a-number")).toBeNull();
    expect((await signCheckin(id, new Date(), readPlanFromChain, simEnv())).sessionNo).toBe(1);
  });

  it("the registry simulator names the merchant the offers are signed by, and the contract accepts its attestation", async () => {
    const fitbox = SIM_MERCHANTS.find((m) => m.id === "FITBOX_FUTIAN")!;
    expect(simMerchantAddress(fitbox, simEnv())).toBe(ADDR.merchant);
    expect(simMerchantAddress(fitbox, {})).toBe(fitbox.address); // mock escrow, no key: the seeded address
    const other = SIM_MERCHANTS.find((m) => m.id === "IRONPULSE_NANSHAN")!;
    expect(simMerchantAddress(other, simEnv())).toBe(other.address);

    await sendAs(chain, KEYS.relayer, "purchaseWithPermit", purchaseCallArgs(await signedPurchase(chain, { units: 4 })));
    const planId = await lastPlanId();

    const att = await publishAttestation({ merchant: fitbox, kind: "closure_notice", env: simEnv() });
    expect(att.merchant).toBe(ADDR.merchant);
    // The agent key submits the registry's attestation exactly as served; the contract verifies the oracle.
    await sendAs(chain, KEYS.agent, "exitWithAttestation", [
      planId,
      { merchant: att.merchant as Hex, kind: att.kind, caseRef: att.caseRef as Hex, issuedAt: BigInt(att.issuedAt), expiresAt: BigInt(att.expiresAt) },
      att.signature as Hex,
    ]);
    const plan = await chain.client.readContract({ address: chain.escrow, abi: PREPAID_ESCROW_ABI, functionName: "getPlan", args: [planId] });
    expect(plan.status).toBe(3); // ExitedAttested
  });
});
