// Owner: R3 (roles.md).
// Mock EscrowAdapter (architecture §24.5, §24.13) against the in-process mock bank: purchase,
// redeem, attested and voluntary exit map to ChainResult, and reverts come back as `reverted`.
// Lives next to the adapter because only executor and adapter code may import it (ESLint, G1).
// Skipped when DATABASE_URL is not set.

import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getMockbankPool, setMockbankPool } from "@/src/mockbank/db";
import { DB_ENABLED, adminPool, inProcessTransport } from "@/tests/foundations/helpers";
import { setTestOracle } from "@/tests/foundations/attestations";
import { expectPlanInvariant, newParties, nowS, redeemBody, signAttestationWire, signPurchase, signVoluntaryExit } from "@/tests/foundations/escrow";
import { createMockEscrow } from "./mockbank";

describe.skipIf(!DB_ENABLED)("mock escrow adapter", () => {
  let admin: Pool;
  let restoreOracle: () => void;
  // userId is ignored by the mock escrow; the chain adapter scopes chain_txs by it.
  const opts = () => ({ actionId: randomUUID(), idempotencyKey: `escrow-adapter:${randomUUID()}`, userId: randomUUID() });

  beforeAll(() => {
    process.env.MOCKBANK_API_KEY ??= "test-mockbank-key";
    restoreOracle = setTestOracle();
    admin = adminPool();
  });

  afterAll(async () => {
    restoreOracle();
    await admin.end();
    await getMockbankPool().end();
    setMockbankPool(null);
  });

  it("purchases, redeems and exits with an attestation from the agent address", async () => {
    const p = newParties();
    const escrow = createMockEscrow({ transport: inProcessTransport, agentAddress: p.agent.address });
    const bought = await escrow.purchase(await signPurchase(p, { offer: { units: 5 } }), opts());
    expect(bought).toMatchObject({ status: "confirmed", blockNumber: null });
    if (bought.status !== "confirmed") throw new Error("purchase failed");
    expect(bought.txHash).toMatch(/^mock:/);
    const chainPlanId = String((bought.events[0] as { chainPlanId: string }).chainPlanId);

    const session = await redeemBody(p, chainPlanId, 1);
    const redeemOpts = opts();
    const redeemed = await escrow.redeem({ chainPlanId, ...session }, redeemOpts);
    expect(redeemed.status).toBe("confirmed");
    expect(await escrow.readPlan(chainPlanId)).toMatchObject({ owner: p.consumer.address, unitsRedeemed: 1, status: "active" });
    // Replays by key; the stored result is found by lookup.
    expect(await escrow.redeem({ chainPlanId, ...session }, redeemOpts)).toMatchObject({ status: "confirmed", txHash: (redeemed as { txHash: string }).txHash });
    expect(await escrow.lookup(redeemOpts.idempotencyKey)).toMatchObject({ status: "confirmed" });

    const attestation = await signAttestationWire({ merchant: p.merchant.address });
    const exited = await escrow.exitWithAttestation({ chainPlanId, attestationId: randomUUID(), attestation }, opts());
    expect(exited).toMatchObject({ status: "confirmed", events: [{ refundTo: p.consumer.address, refund: "40000", fee: "0" }] });
    expect(await escrow.readPlan(chainPlanId)).toMatchObject({ status: "exited_attested" });
    await expectPlanInvariant(admin, chainPlanId);
  });

  it("returns reverted for a forged attestation and for a non-agent caller", async () => {
    const p = newParties();
    const escrow = createMockEscrow({ transport: inProcessTransport, agentAddress: p.agent.address });
    const bought = await escrow.purchase(await signPurchase(p), opts());
    const chainPlanId = String(((bought as { events: { chainPlanId: string }[] }).events[0]).chainPlanId);
    const forged = await signAttestationWire({ merchant: p.merchant.address, signerKey: `0x${"42".repeat(32)}` });
    expect(await escrow.exitWithAttestation({ chainPlanId, attestationId: randomUUID(), attestation: forged }, opts())).toEqual({
      status: "reverted",
      txHash: null,
      reason: "oracle_signature_invalid",
    });
    const stranger = createMockEscrow({ transport: inProcessTransport, agentAddress: newParties().agent.address });
    const good = await signAttestationWire({ merchant: p.merchant.address });
    expect(await stranger.exitWithAttestation({ chainPlanId, attestationId: randomUUID(), attestation: good }, opts())).toMatchObject({
      status: "reverted",
      reason: "caller_not_owner_or_agent",
    });
    expect(await escrow.readPlan(chainPlanId)).toMatchObject({ status: "active" });
  });

  it("exits voluntarily only with the owner's signature", async () => {
    const p = newParties();
    const escrow = createMockEscrow({ transport: inProcessTransport, agentAddress: p.agent.address });
    const bought = await escrow.purchase(await signPurchase(p), opts());
    const chainPlanId = String(((bought as { events: { chainPlanId: string }[] }).events[0]).chainPlanId);
    // @ts-expect-error unsigned call: the interface requires the owner's signature (§24.5); the escrow must still revert at runtime
    expect(await escrow.exitVoluntary({ chainPlanId }, opts())).toMatchObject({ status: "reverted", reason: "consumer_signature_required" });
    const deadline = nowS() + 600;
    const r = await escrow.exitVoluntary({ chainPlanId, deadline, consumerSig: await signVoluntaryExit(p.consumer, chainPlanId, deadline) }, opts());
    expect(r).toMatchObject({ status: "confirmed", events: [{ refund: "90000", fee: "10000" }] });
    await expectPlanInvariant(admin, chainPlanId);
  });
});
