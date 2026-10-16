import { describe, expect, it } from "vitest";
import { getAccounts } from "@/src/server/db/read/accounts";
import { billOrigin, listBills } from "@/src/server/db/read/bills";
import { chainTxRef, type Queryable, zTs } from "@/src/server/db/read/db";
import { getFxRateRow } from "@/src/server/db/read/fx";
import { listPrepaidPlans } from "@/src/server/db/read/prepaid";
import { listRiskSignals } from "@/src/server/db/read/risk";
import { getUserSettings } from "@/src/server/db/read/settings";
import { listSubscriptions, setTrialKeepFlag } from "@/src/server/db/read/subscriptions";
import { listTransactions } from "@/src/server/db/read/transactions";

const U = "11111111-1111-4111-8111-111111111111";

function fake(...results: unknown[][]): Queryable & { calls: { text: string; values?: unknown[] }[] } {
  const calls: { text: string; values?: unknown[] }[] = [];
  let i = 0;
  return {
    calls,
    async query(text: string, values?: unknown[]) {
      calls.push({ text, values });
      return { rows: results[i++] ?? [] };
    },
  };
}

describe("read repositories parse pg rows", () => {
  it("accounts: numeric strings become numbers; user id is bound", async () => {
    const q = fake([{ id: "a1", provider: "mockbank", type: "checking", currency: "CNY", balance: "9850.00", updated_at: "2026-10-17 01:00:00+00" }]);
    const rows = await getAccounts(q, U);
    expect(rows[0].balance).toBe(9850);
    expect(rows[0].updated_at).toBe("2026-10-17T01:00:00.000Z");
    expect(q.calls[0].values).toEqual([U]);
  });

  it("transactions: filters bound in order and origins validated", async () => {
    const q = fake([
      {
        id: "t1", account_id: "a1", posted_at: "2026-10-05", amount: "-30.00", currency: "CNY", raw_descriptor: "IQIYI",
        original_amount: null, original_currency: null, fx_rate: null, fx_rate_date: null, merchant_id: "m1",
        merchant_name: "iQIYI", category: "video", source_id: "mock:tx-1005", origin: "mock_bank",
      },
    ]);
    const rows = await listTransactions(q, U, { from: "2026-10-01", to: "2026-10-31" });
    expect(rows[0]).toMatchObject({ amount: -30, posted_at: "2026-10-05T00:00:00.000Z", origin: "mock_bank" });
    expect(q.calls[0].values).toEqual([U, "2026-10-01", "2026-10-31", null]);
  });

  it("rejects unknown origins instead of passing them through", async () => {
    const q = fake([
      {
        id: "t1", account_id: "a1", posted_at: "2026-10-05", amount: "1", currency: "CNY", raw_descriptor: null,
        original_amount: null, original_currency: null, fx_rate: null, fx_rate_date: null, merchant_id: null,
        merchant_name: null, category: null, source_id: null, origin: "llm",
      },
    ]);
    await expect(listTransactions(q, U, { from: "2026-10-01", to: "2026-10-31" })).rejects.toThrow(/failed validation/);
  });

  it("bills: origin from amount_origin; payee ref is never selected", async () => {
    const q = fake([{ id: "b1", biller_id: "SZ_POWER", biller_name: "State Grid Shenzhen", amount: "186", currency: "CNY", amount_origin: "mock_bank", due_date: "2026-10-22", period: "2026-10", document_id: null, status: "pending", created_at: null }]);
    const rows = await listBills(q, U, "pending");
    expect(billOrigin(rows[0])).toBe("mock_bank");
    expect(billOrigin({ amount_origin: "document" })).toBe("document");
    expect(q.calls[0].text).not.toContain("payee_account_ref");
  });

  it("subscriptions parse and keep-flag checks ownership and trial status", async () => {
    const row = {
      id: "s1", merchant_id: "m1", merchant_name: "Tencent Video", category: "video", cycle_days: 30, amount: "30",
      currency: "CNY", next_renewal: null, billing_currency: null, original_amount: null, status: "trial",
      first_seen: "2026-09-21", last_charged: null, confidence: "0.9", detection_source: "mock_bank",
      trial_end: "2026-10-21 00:00:00+00", trial_status_origin: "mock_bank", keep_flag: false,
    };
    expect((await listSubscriptions(fake([row]), U))[0]).toMatchObject({ amount: 30, confidence: 0.9, status: "trial" });
    expect(await setTrialKeepFlag(fake([]), U, "s1")).toBe("not_found");
    expect(await setTrialKeepFlag(fake([{ status: "active" }]), U, "s1")).toBe("not_trial");
    const q = fake([{ status: "trial" }], []);
    expect(await setTrialKeepFlag(q, U, "s1")).toBe("ok");
    expect(q.calls[1].text).toContain("keep_flag = true");
    expect(q.calls[1].values).toEqual([U, "s1"]);
  });

  it("settings: mandate values with safe fallbacks", async () => {
    const s = await getUserSettings(
      fake([{ version: 3, policy_json: { base_currency: "CNY", subscriptions: { auto_cancel_trials: { enabled: true, days_before_charge: 1 } } } }], []),
      U,
    );
    expect(s).toMatchObject({ baseCurrency: "CNY", mandateVersion: 3, autoCancelTrials: { enabled: true, daysBeforeCharge: 1 } });
    const d = await getUserSettings(fake([], [{ base_currency: "IDR" }]), U);
    expect(d).toMatchObject({ baseCurrency: "IDR", mandateVersion: null, autoCancelTrials: null, anomaly: { k: 3.5, minHistory: 3 } });
  });

  it("fx: only fx_provider rows are accepted", async () => {
    const ok = await getFxRateRow(fake([{ date: "2026-10-16", base: "USD", quote: "CNY", rate: "7.1200", source: "fx_provider", fetched_at: null }]), "USD", "CNY", "2026-10-17");
    expect(ok?.rate).toBe(7.12);
    await expect(
      getFxRateRow(fake([{ date: "2026-10-16", base: "USD", quote: "CNY", rate: "7", source: "document", fetched_at: null }]), "USD", "CNY", "2026-10-17"),
    ).rejects.toThrow();
  });

  it("prepaid plans keep origin chain; signals keep simulated flags", async () => {
    const plans = await listPrepaidPlans(
      fake([{ id: "p1", chain_plan_id: "1", merchant_id: "FITBOX_FUTIAN", merchant_name: "FitBox Futian", merchant_risk_level: "watch", unit_price: "10000", units_total: 60, units_redeemed: 12, cancel_fee_bps: 1000, agent_address: null, status: "active", purchase_tx: "0xabc", origin: "chain" }]),
      U,
    );
    expect(plans[0]).toMatchObject({ unit_price: 10000, origin: "chain" });
    const sig = await listRiskSignals(
      fake([{ id: "r1", merchant_id: "FITBOX_FUTIAN", kind: "complaints", level: "watch", summary: "x", source_ids: ["sim:c1"], origin: "simulated", simulated: true, observed_at: "2026-10-15 08:00:00+00" }]),
      ["FITBOX_FUTIAN"],
    );
    expect(sig[0]).toMatchObject({ simulated: true, origin: "simulated" });
    expect(await listRiskSignals(fake(), [])).toEqual([]);
  });

  it("helpers", () => {
    expect(zTs.parse("2026-10-10")).toBe("2026-10-10T00:00:00.000Z");
    expect(zTs.parse(new Date("2026-10-10T01:02:03Z"))).toBe("2026-10-10T01:02:03.000Z");
    expect(chainTxRef("mock:purchase-1")).toEqual({ hash: "mock:purchase-1", explorerUrl: "", simulated: true });
    expect(chainTxRef("0xab").explorerUrl).toBe("https://sepolia.basescan.org/tx/0xab");
  });
});
