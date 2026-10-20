// Owner: R3 (roles.md).
// Mock escrow rules (architecture §24.3, §24.11 "Foundry unit", §24.13) over the mock bank HTTP
// API, in process: every require of purchase, redeem, attested exit and voluntary exit, plus
// the money invariant (G9/G10) after each sequence. Skipped when DATABASE_URL is not set.

import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getMockbankPool, setMockbankPool } from "@/src/mockbank/db";
import { escrowDomainFromEnv, offerHash, purchaseAuthDigest } from "@/src/server/chain/types";
import { DB_ENABLED, adminPool, inProcessTransport } from "./helpers";
import { TEST_ORACLE_ADDRESS, randomKey, setTestOracle } from "./attestations";
import {
  expectPlanInvariant,
  newAccount,
  newParties,
  nowS,
  redeemBody,
  signAttestationWire,
  signPurchase,
  signRedeem,
  signVoluntaryExit,
  type Parties,
  type PurchaseBody,
} from "./escrow";

type Res = { status: number; json: Record<string, unknown> };

async function mb(method: "GET" | "POST", path: string, body?: unknown, key: string = `escrow-test:${randomUUID()}`): Promise<Res> {
  const res = await inProcessTransport(
    new Request(`http://mockbank.test/mockbank${path}`, {
      method,
      headers: { "x-api-key": process.env.MOCKBANK_API_KEY ?? "", "content-type": "application/json", "idempotency-key": key },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe.skipIf(!DB_ENABLED)("mock escrow: contract rules and signatures", () => {
  let admin: Pool;
  let restoreOracle: () => void;

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

  const purchase = (body: PurchaseBody, key?: string) => mb("POST", "/escrow/purchase", body, key);

  async function bought(o: Parameters<typeof signPurchase>[1] = {}): Promise<{ p: Parties; planId: string; body: PurchaseBody }> {
    const p = newParties();
    const body = await signPurchase(p, o);
    const r = await purchase(body);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    return { p, planId: String(r.json.chainPlanId), body };
  }

  async function planRow(planId: string) {
    return (
      await admin.query(
        `select owner, merchant, agent, unit_price::int as unit_price, units_total, units_redeemed, cancel_fee_bps, status,
                balance::text as balance, offer_hash, purchase_tx
           from mockbank.escrow_plans where chain_plan_id = $1`,
        [planId],
      )
    ).rows[0];
  }

  async function payoutCount(planId: string) {
    return Number((await admin.query("select count(*) from mockbank.escrow_payouts where chain_plan_id = $1", [planId])).rows[0].count);
  }

  /** A reverted call left the plan untouched. */
  async function expectUntouched(planId: string, before: Record<string, unknown>, payouts: number) {
    expect(await planRow(planId)).toEqual(before);
    expect(await payoutCount(planId)).toBe(payouts);
  }

  // ---- purchase ---------------------------------------------------------------------------

  describe("purchase", () => {
    it("creates an active plan owned by the consumer and marks the authorization used", async () => {
      const { p, planId, body } = await bought();
      expect(Number(planId)).toBeGreaterThanOrEqual(1000);
      const row = await planRow(planId);
      expect(row).toMatchObject({
        owner: p.consumer.address,
        merchant: p.merchant.address,
        agent: p.agent.address,
        unit_price: 10000,
        units_total: 10,
        units_redeemed: 0,
        cancel_fee_bps: 1000,
        status: "active",
        balance: "100000",
        offer_hash: offerHash(escrowDomainFromEnv(), body.offer).toLowerCase(),
      });
      expect(row.purchase_tx).toMatch(/^mock:/);
      const digest = purchaseAuthDigest(escrowDomainFromEnv(), body.auth).toLowerCase();
      const used = await admin.query("select chain_plan_id::text as id from mockbank.escrow_auth_used where digest = $1", [digest]);
      expect(used.rows).toEqual([{ id: planId }]);
      await expectPlanInvariant(admin, planId);
    });

    it("replays the same idempotency key without a second plan", async () => {
      const p = newParties();
      const body = await signPurchase(p);
      const key = `escrow-test:${randomUUID()}`;
      const r1 = await purchase(body, key);
      const r2 = await purchase(body, key);
      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
      expect(r2.json).toMatchObject({ chainPlanId: r1.json.chainPlanId, txHash: r1.json.txHash, replayed: true });
      const n = await admin.query("select count(*) from mockbank.escrow_plans where owner = $1", [p.consumer.address]);
      expect(Number(n.rows[0].count)).toBe(1);
    });

    it("rejects a reused authorization under a new idempotency key", async () => {
      const { p, body } = await bought();
      const r = await purchase(body);
      expect(r).toMatchObject({ status: 422, json: { error: "auth_used" } });
      const n = await admin.query("select count(*) from mockbank.escrow_plans where owner = $1", [p.consumer.address]);
      expect(Number(n.rows[0].count)).toBe(1);
    });

    it.each([
      ["an expired offer", { offer: { expiresAt: nowS() - 10 } }, "expired"],
      ["an expired authorization", { auth: { deadline: nowS() - 10 } }, "expired"],
      ["zero units", { offer: { units: 0 } }, "invalid_terms"],
      ["a zero unit price", { offer: { unitPrice: 0 } }, "invalid_terms"],
      ["a cancel fee above 20%", { offer: { cancelFeeBps: 2001 } }, "invalid_terms"],
      ["an offer signed by another key", { merchantSigner: newAccount() }, "merchant_signature_invalid"],
      ["an authorization signed by another key", { consumerSigner: newAccount() }, "consumer_signature_invalid"],
      ["an authorization bound to another offer", { authOfferHash: ("0x" + "11".repeat(32)) as `0x${string}` }, "offer_hash_mismatch"],
    ] as const)("rejects %s", async (_label, o, code) => {
      const p = newParties();
      const body = await signPurchase(p, o as Parameters<typeof signPurchase>[1]);
      const r = await purchase(body);
      expect(r).toMatchObject({ status: 422, json: { error: code } });
      const n = await admin.query("select count(*) from mockbank.escrow_plans where owner = $1", [p.consumer.address]);
      expect(Number(n.rows[0].count)).toBe(0);
    });

    it("rejects terms changed after the merchant signed them", async () => {
      const p = newParties();
      const body = await signPurchase(p);
      const r = await purchase({ ...body, offer: { ...body.offer, unitPrice: 1 } });
      expect(r).toMatchObject({ status: 422, json: { error: "merchant_signature_invalid" } });
    });

    it("accepts a 20% cancel fee", async () => {
      const { planId } = await bought({ offer: { cancelFeeBps: 2000 } });
      expect((await planRow(planId)).cancel_fee_bps).toBe(2000);
    });

    it("rejects malformed input", async () => {
      expect(await purchase({ offer: {} } as unknown as PurchaseBody)).toMatchObject({ status: 400, json: { error: "invalid_request" } });
    });
  });

  // ---- redeem -----------------------------------------------------------------------------

  describe("redeem", () => {
    const redeem = (planId: string, body: unknown, key?: string) => mb("POST", `/escrow/plans/${planId}/redeem`, body, key);

    it("pays one unit to the merchant per two-signature session", async () => {
      const { p, planId } = await bought();
      const r = await redeem(planId, await redeemBody(p, planId, 1));
      expect(r.status, JSON.stringify(r.json)).toBe(200);
      expect(r.json).toMatchObject({ status: "confirmed", event: "Redeemed", sessionNo: 1, amount: "10000", paidTo: p.merchant.address });
      expect(await planRow(planId)).toMatchObject({ units_redeemed: 1, balance: "90000", status: "active" });
      const pay = await admin.query("select to_address, role, amount::int as amount, reason from mockbank.escrow_payouts where chain_plan_id = $1", [planId]);
      expect(pay.rows).toEqual([{ to_address: p.merchant.address, role: "merchant", amount: 10000, reason: "redeem" }]);
      const s = await admin.query("select session_no from mockbank.escrow_sessions where chain_plan_id = $1", [planId]);
      expect(s.rows).toEqual([{ session_no: 1 }]);
      await expectPlanInvariant(admin, planId);
    });

    it("rejects a wrong or replayed session number", async () => {
      const { p, planId } = await bought();
      expect(await redeem(planId, await redeemBody(p, planId, 2))).toMatchObject({ status: 422, json: { error: "wrong_session" } });
      const first = await redeemBody(p, planId, 1);
      expect((await redeem(planId, first)).status).toBe(200);
      // The same signed session with a new idempotency key.
      expect(await redeem(planId, first)).toMatchObject({ status: 422, json: { error: "wrong_session" } });
      expect((await planRow(planId)).units_redeemed).toBe(1);
      await expectPlanInvariant(admin, planId);
    });

    it("rejects an expired session", async () => {
      const { p, planId } = await bought();
      const before = await planRow(planId);
      expect(await redeem(planId, await redeemBody(p, planId, 1, nowS() - 10))).toMatchObject({ status: 422, json: { error: "expired" } });
      await expectUntouched(planId, before, 0);
    });

    it("needs both the owner's and the merchant's signature", async () => {
      const { p, planId } = await bought();
      const before = await planRow(planId);
      const deadline = nowS() + 600;
      const m = await signRedeem(p.merchant, planId, 1, deadline);
      const c = await signRedeem(p.consumer, planId, 1, deadline);
      expect(await redeem(planId, { sessionNo: 1, deadline, consumerSig: m, merchantSig: m })).toMatchObject({
        status: 422,
        json: { error: "consumer_signature_invalid" },
      });
      expect(await redeem(planId, { sessionNo: 1, deadline, consumerSig: c, merchantSig: c })).toMatchObject({
        status: 422,
        json: { error: "merchant_signature_invalid" },
      });
      // The agent key cannot stand in for the owner.
      const a = await signRedeem(p.agent, planId, 1, deadline);
      expect(await redeem(planId, { sessionNo: 1, deadline, consumerSig: a, merchantSig: m })).toMatchObject({
        status: 422,
        json: { error: "consumer_signature_invalid" },
      });
      // Signatures for another plan do not transfer.
      const other = await bought();
      const foreign = await redeemBody(other.p, other.planId, 1, deadline);
      expect(await redeem(planId, foreign)).toMatchObject({ status: 422, json: { error: "consumer_signature_invalid" } });
      await expectUntouched(planId, before, 0);
    });

    it("completes the plan after the last unit and rejects further sessions", async () => {
      const { p, planId } = await bought({ offer: { units: 2 } });
      expect((await redeem(planId, await redeemBody(p, planId, 1))).status).toBe(200);
      const last = await redeem(planId, await redeemBody(p, planId, 2));
      expect(last.json).toMatchObject({ completed: true });
      expect(await planRow(planId)).toMatchObject({ status: "completed", units_redeemed: 2, balance: "0" });
      expect(await redeem(planId, await redeemBody(p, planId, 3))).toMatchObject({ status: 409, json: { error: "plan_not_active" } });
      await expectPlanInvariant(admin, planId);
    });

    it("404s an unknown plan", async () => {
      const p = newParties();
      expect(await redeem("999999999999", await redeemBody(p, "999999999999", 1))).toMatchObject({ status: 404, json: { error: "plan_not_found" } });
    });
  });

  // ---- exitWithAttestation ------------------------------------------------------------------

  describe("attested exit", () => {
    const exit = (planId: string, body: unknown, key?: string) => mb("POST", `/escrow/plans/${planId}/exit-attested`, body, key);

    async function redeemedOnce() {
      const b = await bought();
      const r = await mb("POST", `/escrow/plans/${b.planId}/redeem`, await redeemBody(b.p, b.planId, 1));
      expect(r.status).toBe(200);
      return b;
    }

    it("refunds the full unused balance to the owner when the agent calls", async () => {
      const { p, planId } = await redeemedOnce();
      const attestation = await signAttestationWire({ merchant: p.merchant.address });
      const r = await exit(planId, { caller: p.agent.address, attestation, attestation_id: randomUUID() });
      expect(r.status, JSON.stringify(r.json)).toBe(200);
      expect(r.json).toMatchObject({ status: "confirmed", event: "ExitedAttested", refundTo: p.consumer.address, refund: "90000", fee: "0" });
      expect(String(r.json.txHash)).toMatch(/^mock:/);
      expect(await planRow(planId)).toMatchObject({ status: "exited_attested", balance: "0" });
      const pay = await admin.query(
        "select to_address, role, amount::int as amount, reason from mockbank.escrow_payouts where chain_plan_id = $1 and reason <> 'redeem'",
        [planId],
      );
      expect(pay.rows).toEqual([{ to_address: p.consumer.address, role: "consumer", amount: 90000, reason: "exit_attested" }]);
      await expectPlanInvariant(admin, planId);
      // A second exit (new key) meets a non-active plan.
      expect(await exit(planId, { caller: p.agent.address, attestation })).toMatchObject({ status: 409, json: { error: "plan_not_active" } });
      await expectPlanInvariant(admin, planId);
    });

    it("lets the owner call it too", async () => {
      const { p, planId } = await bought();
      const attestation = await signAttestationWire({ merchant: p.merchant.address });
      expect((await exit(planId, { caller: p.consumer.address, attestation })).status).toBe(200);
      await expectPlanInvariant(admin, planId);
    });

    it.each([
      ["signed by a key that is not the oracle", { signerKey: randomKey() }, 422, "oracle_signature_invalid"],
      ["for another merchant", { merchant: "0x" + "ab".repeat(20) }, 422, "attestation_merchant_mismatch"],
      ["older than two days", { issuedAt: nowS() - 2 * 86_400 - 120, expiresAt: nowS() + 86_400 }, 422, "attestation_stale"],
      ["issued in the future", { issuedAt: nowS() + 600 }, 422, "attestation_window"],
      ["already expired", { issuedAt: nowS() - 7200, expiresAt: nowS() - 10 }, 422, "attestation_window"],
      ["of an unknown kind", { kind: 3 }, 422, "attestation_kind_invalid"],
    ] as const)("rejects an attestation %s", async (_label, o, status, code) => {
      const { p, planId } = await redeemedOnce();
      const before = await planRow(planId);
      const attestation = await signAttestationWire({ merchant: p.merchant.address, ...o });
      expect(await exit(planId, { caller: p.agent.address, attestation })).toMatchObject({ status, json: { error: code } });
      await expectUntouched(planId, before, 1);
      await expectPlanInvariant(admin, planId);
    });

    it("rejects an attestation altered after signing", async () => {
      const { p, planId } = await bought();
      const attestation = await signAttestationWire({ merchant: p.merchant.address });
      const r = await exit(planId, { caller: p.agent.address, attestation: { ...attestation, caseRef: "0x" + "22".repeat(32) } });
      expect(r).toMatchObject({ status: 422, json: { error: "oracle_signature_invalid" } });
    });

    it("rejects a caller that is neither the owner nor the agent", async () => {
      const { p, planId } = await bought();
      const before = await planRow(planId);
      const attestation = await signAttestationWire({ merchant: p.merchant.address });
      expect(await exit(planId, { caller: p.merchant.address, attestation })).toMatchObject({ status: 403, json: { error: "caller_not_owner_or_agent" } });
      expect(await exit(planId, { caller: newAccount().address, attestation })).toMatchObject({ status: 403 });
      expect(await exit(planId, { attestation })).toMatchObject({ status: 403 });
      await expectUntouched(planId, before, 0);
    });

    it("needs the signed attestation, not just an id", async () => {
      const { p, planId } = await bought();
      expect(await exit(planId, { caller: p.agent.address, attestation_id: randomUUID() })).toMatchObject({
        status: 400,
        json: { error: "attestation_required" },
      });
      expect(await exit(planId, { caller: p.agent.address, attestation: { merchant: p.merchant.address } })).toMatchObject({
        status: 400,
        json: { error: "invalid_request" },
      });
    });

    it("reverts when no oracle is configured", async () => {
      const { p, planId } = await bought();
      const attestation = await signAttestationWire({ merchant: p.merchant.address });
      const saved = process.env.ORACLE_ADDRESS;
      delete process.env.ORACLE_ADDRESS;
      try {
        expect(await exit(planId, { caller: p.agent.address, attestation })).toMatchObject({ status: 422, json: { error: "oracle_not_configured" } });
      } finally {
        process.env.ORACLE_ADDRESS = saved;
      }
      expect(process.env.ORACLE_ADDRESS).toBe(TEST_ORACLE_ADDRESS);
      expect((await planRow(planId)).status).toBe("active");
    });
  });

  // ---- exitVoluntaryBySig -------------------------------------------------------------------

  describe("voluntary exit", () => {
    const exit = (planId: string, body: unknown, key?: string) => mb("POST", `/escrow/plans/${planId}/exit-voluntary`, body, key);

    it("pays the fee to the merchant and the rest to the owner", async () => {
      const { p, planId } = await bought({ offer: { unitPrice: 9999, units: 7, cancelFeeBps: 1500 } });
      expect((await mb("POST", `/escrow/plans/${planId}/redeem`, await redeemBody(p, planId, 1))).status).toBe(200);
      const remaining = BigInt(9999 * 6);
      const fee = (remaining * BigInt(1500)) / BigInt(10_000);
      const deadline = nowS() + 600;
      const r = await exit(planId, { deadline, consumerSig: await signVoluntaryExit(p.consumer, planId, deadline) });
      expect(r.status, JSON.stringify(r.json)).toBe(200);
      expect(r.json).toMatchObject({
        status: "confirmed",
        event: "ExitedVoluntary",
        refundTo: p.consumer.address,
        refund: (remaining - fee).toString(),
        fee: fee.toString(),
      });
      expect(await planRow(planId)).toMatchObject({ status: "exited_voluntary", balance: "0" });
      const pay = await admin.query(
        "select to_address, role, amount::text as amount, reason from mockbank.escrow_payouts where chain_plan_id = $1 and reason <> 'redeem' order by reason",
        [planId],
      );
      expect(pay.rows).toEqual([
        { to_address: p.merchant.address, role: "merchant", amount: fee.toString(), reason: "exit_voluntary_fee" },
        { to_address: p.consumer.address, role: "consumer", amount: (remaining - fee).toString(), reason: "exit_voluntary_refund" },
      ]);
      await expectPlanInvariant(admin, planId);
    });

    it("reverts without the owner's signature", async () => {
      const { planId } = await bought();
      const before = await planRow(planId);
      expect(await exit(planId, {})).toMatchObject({ status: 422, json: { error: "consumer_signature_required" } });
      expect(await exit(planId, { caller: "0x" + "cd".repeat(20) })).toMatchObject({ status: 422, json: { error: "consumer_signature_required" } });
      await expectUntouched(planId, before, 0);
    });

    it("reverts with a signature from anyone but the owner, or for another plan", async () => {
      const { p, planId } = await bought();
      const before = await planRow(planId);
      const deadline = nowS() + 600;
      for (const signer of [p.agent, p.merchant, newAccount()]) {
        expect(await exit(planId, { deadline, consumerSig: await signVoluntaryExit(signer, planId, deadline) })).toMatchObject({
          status: 422,
          json: { error: "consumer_signature_invalid" },
        });
      }
      const other = await bought();
      expect(await exit(planId, { deadline, consumerSig: await signVoluntaryExit(p.consumer, other.planId, deadline) })).toMatchObject({
        status: 422,
        json: { error: "consumer_signature_invalid" },
      });
      // Same signature, different deadline than signed.
      expect(await exit(planId, { deadline: deadline + 1, consumerSig: await signVoluntaryExit(p.consumer, planId, deadline) })).toMatchObject({
        status: 422,
        json: { error: "consumer_signature_invalid" },
      });
      await expectUntouched(planId, before, 0);
    });

    it("reverts after the deadline and on an inactive plan", async () => {
      const { p, planId } = await bought();
      const past = nowS() - 10;
      expect(await exit(planId, { deadline: past, consumerSig: await signVoluntaryExit(p.consumer, planId, past) })).toMatchObject({
        status: 422,
        json: { error: "expired" },
      });
      const deadline = nowS() + 600;
      const sig = await signVoluntaryExit(p.consumer, planId, deadline);
      expect((await exit(planId, { deadline, consumerSig: sig })).status).toBe(200);
      expect(await exit(planId, { deadline, consumerSig: sig })).toMatchObject({ status: 409, json: { error: "plan_not_active" } });
      await expectPlanInvariant(admin, planId);
    });
  });
});
