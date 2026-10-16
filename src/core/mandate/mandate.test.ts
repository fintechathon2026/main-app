import { describe, expect, it } from "vitest";
import { actionHash, canonical, hashPolicy, parsePolicy } from "./index";
import { LIN_MANDATE_V3 } from "./examples";

describe("parsePolicy", () => {
  it("accepts Lin's v3 mandate", () => {
    const r = parsePolicy(LIN_MANDATE_V3);
    expect(r.ok).toBe(true);
  });

  it("rejects unknown fields", () => {
    const r = parsePolicy({ ...LIN_MANDATE_V3, bills: { ...LIN_MANDATE_V3.bills, auto_pay_unlimited: true } });
    expect(r.ok).toBe(false);
  });

  it("defaults missing fields to the most restrictive value", () => {
    const r = parsePolicy({ version: 1, base_currency: "CNY" });
    if (!r.ok) throw new Error(r.errors.join(";"));
    expect(r.policy.payees).toEqual({ allow: [], new_payee: "deny" });
    expect(r.policy.bills.auto_pay_max).toBe(0);
    expect(r.policy.subscriptions.cancel).toBe("deny");
    expect(r.policy.subscriptions.auto_cancel_trials.enabled).toBe(false);
    expect(r.policy.prepaid.purchase).toBe("deny");
    expect(r.policy.prepaid.escrow_only).toBe(true);
    expect(r.policy.prepaid.auto_exit_on).toEqual([]);
    expect(r.policy.global.daily_outflow_cap).toBe(0);
  });
});

describe("canonical hashes", () => {
  it("is independent of key order", () => {
    expect(canonical({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
    const shuffled = Object.fromEntries(Object.entries(LIN_MANDATE_V3).reverse());
    expect(hashPolicy(shuffled)).toBe(hashPolicy(LIN_MANDATE_V3));
  });

  it("binds the tool name into the action hash", () => {
    const args = { bill_id: "b1", biller_id: "SZ_POWER", amount: 200 };
    expect(actionHash("pay_bill", args)).not.toBe(actionHash("cancel_subscription", args));
    expect(actionHash("pay_bill", args)).toMatch(/^[0-9a-f]{64}$/);
  });
});
