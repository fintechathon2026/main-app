// Owner: R3 (roles.md).
// Merchant simulator (architecture §24.7): signed offers and check-in Redeem signatures. The
// unit part needs no DB (the plan reader is injected); the round trip over the mock escrow runs
// only when DATABASE_URL is set.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { OFFER_TYPES, PURCHASE_AUTH_TYPES, REDEEM_TYPES, escrowDomainFromEnv, offerHash, toOfferMessage, toPurchaseAuthMessage, toRedeemMessage } from "@/src/server/chain/types";
import { signCheckin, type EscrowPlanView, type PlanReader } from "@/src/sim/merchant/checkin";
import { handleCheckin, handleOffers } from "@/src/sim/merchant/http";
import { listOffers } from "@/src/sim/merchant/offers";
import { getMockbankPool, setMockbankPool } from "@/src/mockbank/db";
import { DB_ENABLED, adminPool, inProcessTransport } from "../foundations/helpers";
import { expectPlanInvariant, newAccount, nowS, signRedeem } from "../foundations/escrow";

// Anvil test account #0 (public test key, never funded anywhere real).
const ANVIL_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const SIM = privateKeyToAccount(ANVIL_KEY);

const plan = (o: Partial<EscrowPlanView> = {}): EscrowPlanView => ({
  chain_plan_id: "1001",
  merchant: SIM.address.toLowerCase(),
  status: "active",
  units_redeemed: 3,
  ...o,
});
const reader =
  (p: EscrowPlanView | null): PlanReader =>
  async () =>
    p;
const checkinReq = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://sim.test/sim/merchant/checkin", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

describe("merchant simulator", () => {
  beforeEach(() => {
    vi.stubEnv("MERCHANT_SIM_PRIVATE_KEY", ANVIL_KEY);
    vi.stubEnv("SIM_API_KEY", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("lists offers signed by the merchant key, including one without escrow", async () => {
    const now = new Date("2026-10-20T00:00:00Z");
    const offers = await listOffers(now);
    expect(offers.map((o) => o.merchantId)).toEqual(["FITBOX_FUTIAN", "IRONPULSE_NANSHAN"]);
    expect(offers.find((o) => o.merchantId === "IRONPULSE_NANSHAN")?.escrowSupported).toBe(false);
    expect(offers.find((o) => o.merchantId === "FITBOX_FUTIAN")?.escrowSupported).toBe(true);
    for (const o of offers) {
      expect(o.simulated).toBe(true);
      expect(o.offer.merchant).toBe(SIM.address);
      expect(o.offer.expiresAt).toBe(Math.floor(now.getTime() / 1000) + 30 * 86_400);
      const signer = await recoverTypedDataAddress({
        domain: escrowDomainFromEnv(),
        types: OFFER_TYPES,
        primaryType: "Offer",
        message: toOfferMessage(o.offer),
        signature: o.merchantSig,
      });
      expect(signer).toBe(SIM.address);
    }
    expect(new Set(offers.map((o) => o.offer.nonce)).size).toBe(offers.length);
  });

  it("signs Redeem for the next session of its own plan", async () => {
    const now = new Date("2026-10-20T00:00:00Z");
    const c = await signCheckin("1001", now, reader(plan({ units_redeemed: 3 })));
    expect(c).toMatchObject({ planId: "1001", sessionNo: 4, deadline: Math.floor(now.getTime() / 1000) + 600, merchant: SIM.address, simulated: true });
    const signer = await recoverTypedDataAddress({
      domain: escrowDomainFromEnv(),
      types: REDEEM_TYPES,
      primaryType: "Redeem",
      message: toRedeemMessage(c),
      signature: c.merchantSig,
    });
    expect(signer).toBe(SIM.address);
  });

  it("returns the signed check-in over HTTP", async () => {
    const res = await handleCheckin(checkinReq({ planId: "1001" }), reader(plan({ units_redeemed: 0 })));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ planId: "1001", sessionNo: 1, merchant: SIM.address });
  });

  it("rejects an unknown, inactive or other merchant's plan", async () => {
    expect((await handleCheckin(checkinReq({ planId: "1001" }), reader(null))).status).toBe(404);
    const inactive = await handleCheckin(checkinReq({ planId: "1001" }), reader(plan({ status: "exited_attested" })));
    expect(inactive.status).toBe(409);
    expect(await inactive.json()).toEqual({ error: "plan_not_active" });
    const other = await handleCheckin(checkinReq({ planId: "1001" }), reader(plan({ merchant: newAccount().address })));
    expect(other.status).toBe(409);
    expect(await other.json()).toEqual({ error: "not_this_merchant" });
  });

  it("rejects a malformed body", async () => {
    expect((await handleCheckin(checkinReq({ planId: "abc" }), reader(plan()))).status).toBe(400);
    expect((await handleCheckin(checkinReq({ planId: "1", extra: 1 }), reader(plan()))).status).toBe(400);
  });

  it("returns 503 when the merchant key is missing", async () => {
    vi.stubEnv("MERCHANT_SIM_PRIVATE_KEY", "");
    expect((await handleOffers(new Request("http://sim.test/sim/merchant/offers"))).status).toBe(503);
    expect((await handleCheckin(checkinReq({ planId: "1001" }), reader(plan()))).status).toBe(503);
  });

  it("enforces SIM_API_KEY when it is set", async () => {
    vi.stubEnv("SIM_API_KEY", "sim-key-for-tests-0123");
    expect((await handleOffers(new Request("http://sim.test/sim/merchant/offers"))).status).toBe(401);
    expect((await handleCheckin(checkinReq({ planId: "1001" }), reader(plan()))).status).toBe(401);
    const auth = { authorization: "Bearer sim-key-for-tests-0123" };
    expect((await handleOffers(new Request("http://sim.test/sim/merchant/offers", { headers: auth }))).status).toBe(200);
    expect((await handleCheckin(checkinReq({ planId: "1001" }, auth), reader(plan()))).status).toBe(200);
  });
});

describe.skipIf(!DB_ENABLED)("merchant simulator round trip on the mock escrow", () => {
  afterAll(async () => {
    await getMockbankPool().end();
    setMockbankPool(null);
  });

  async function mb(method: "GET" | "POST", path: string, body?: unknown) {
    const res = await inProcessTransport(
      new Request(`http://mockbank.test/mockbank${path}`, {
        method,
        headers: { "x-api-key": process.env.MOCKBANK_API_KEY ?? "", "content-type": "application/json", "idempotency-key": `sim-test:${randomUUID()}` },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  }

  it("purchases with a simulator offer and redeems with the simulator's check-in", async () => {
    vi.stubEnv("MERCHANT_SIM_PRIVATE_KEY", ANVIL_KEY);
    process.env.MOCKBANK_API_KEY ??= "test-mockbank-key";
    const admin = adminPool();
    try {
      const domain = escrowDomainFromEnv();
      const fitbox = (await listOffers()).find((o) => o.merchantId === "FITBOX_FUTIAN")!;
      const consumer = newAccount();
      const auth = { offerHash: offerHash(domain, fitbox.offer), consumer: consumer.address, agent: newAccount().address, deadline: nowS() + 600 };
      const consumerSig = await consumer.signTypedData({ domain, types: PURCHASE_AUTH_TYPES, primaryType: "PurchaseAuth", message: toPurchaseAuthMessage(auth) });
      const bought = await mb("POST", "/escrow/purchase", { offer: fitbox.offer, merchantSig: fitbox.merchantSig, auth, consumerSig });
      expect(bought.status, JSON.stringify(bought.json)).toBe(200);
      const planId = String(bought.json.chainPlanId);

      const readPlan: PlanReader = async (id) => {
        const r = await mb("GET", `/escrow/plans/${id}`);
        return r.status === 404 ? null : (r.json.plan as EscrowPlanView);
      };
      const checkin = await signCheckin(planId, new Date(), readPlan);
      expect(checkin.sessionNo).toBe(1);
      const redeemed = await mb("POST", `/escrow/plans/${planId}/redeem`, {
        sessionNo: checkin.sessionNo,
        deadline: checkin.deadline,
        merchantSig: checkin.merchantSig,
        consumerSig: await signRedeem(consumer, planId, checkin.sessionNo, checkin.deadline),
      });
      expect(redeemed.status, JSON.stringify(redeemed.json)).toBe(200);
      expect((await signCheckin(planId, new Date(), readPlan)).sessionNo).toBe(2);
      const { plan: row } = await expectPlanInvariant(admin, planId);
      expect(row.units_redeemed).toBe(1);
      expect(String(row.merchant).toLowerCase()).toBe(SIM.address.toLowerCase());
    } finally {
      vi.unstubAllEnvs();
      await admin.end();
    }
  });
});
