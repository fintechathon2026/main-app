import { describe, expect, it } from "vitest";
import { RecordedModelClient } from "@/src/agent/models/recorded";
import { structuredKey, type Recording } from "@/src/agent/models/recording-key";
import { MANDATE_COMPILER_SYSTEM } from "@/src/agent/prompts/mandate";
import { MANDATE_SCHEMA_NAME, MandateCompileError, compile } from "@/src/server/mandate/compile";
import { PolicyDraft } from "@/src/server/mandate/schema";
import type { ModelClient } from "@/src/agent/models/types";

const TEXT = "Auto-pay bills up to 300 yuan for SZ_POWER and CHINA_MOBILE. Never more than 1000 a day. Ask me before cancelling.";

function clientReturning(response: unknown): ModelClient {
  const req = { role: "mandate_compiler" as const, system: MANDATE_COMPILER_SYSTEM, input: TEXT, schema: PolicyDraft, schemaName: MANDATE_SCHEMA_NAME };
  const rec: Recording = {
    kind: "structured",
    key: structuredKey(req),
    role: "mandate_compiler",
    request: { ...req, schema: MANDATE_SCHEMA_NAME },
    response,
  };
  return new RecordedModelClient({ recordings: [rec] });
}

describe("mandate compile (k=1)", () => {
  it("fills missing fields with the most restrictive values and reads back from templates", async () => {
    const m = clientReturning({
      payees: { allow: ["SZ_POWER", "CHINA_MOBILE"] },
      bills: { auto_pay_max: 300 },
      subscriptions: { cancel: "confirm" },
      global: { daily_outflow_cap: 1000 },
    });
    const r = await compile(TEXT, { models: { mandate_compiler: m }, baseCurrency: "CNY" });
    expect(r.policy.base_currency).toBe("CNY");
    expect(r.policy.bills.auto_pay_max).toBe(300);
    expect(r.policy.payees.new_payee).toBe("deny");
    expect(r.policy.subscriptions.subscribe).toBe("deny");
    expect(r.policy.subscriptions.auto_cancel_trials.enabled).toBe(false);
    expect(r.policy.prepaid).toMatchObject({ purchase: "deny", max_prepay: 0, auto_exit_on: [], escrow_only: true });
    expect(r.defaulted).toContain("payees.new_payee");
    expect(r.defaulted).not.toContain("bills.auto_pay_max");
    expect(r.readback[0]).toBe("Pay bills automatically up to CNY 300 each; larger or unusual bills need your approval.");
    expect(r.readback).toContain("Total payments per day stay at or below CNY 1,000.");
  });

  it("rejects unknown fields", async () => {
    const m = clientReturning({ bills: { auto_pay_max: 300 }, payees: { allow: ["SZ_POWER"], add_account: "8812" } });
    await expect(compile(TEXT, { models: { mandate_compiler: m }, baseCurrency: "CNY" })).rejects.toThrow();
  });

  it("rejects out-of-range values that structured outputs cannot enforce", async () => {
    const m = clientReturning({ bills: { auto_pay_max: -5 } });
    await expect(compile(TEXT, { models: { mandate_compiler: m }, baseCurrency: "CNY" })).rejects.toThrow();
  });

  it("rejects empty text before calling the model", async () => {
    await expect(compile("  ", { models: { mandate_compiler: clientReturning({}) }, baseCurrency: "CNY" })).rejects.toBeInstanceOf(MandateCompileError);
  });
});
