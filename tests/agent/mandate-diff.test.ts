// Mandate diff and change class (architecture §9.2, PRD §9.4).

import { describe, expect, it } from "vitest";
import { LIN_MANDATE_V3 } from "@/src/core/mandate/examples";
import { parsePolicy } from "@/src/core/mandate/schema";
import { diffPolicies } from "@/src/server/mandate/diff";
import { withDefaults, type Policy, type PolicyDraft } from "@/src/server/mandate/schema";

const base = (): Policy =>
  withDefaults(
    {
      payees: { allow: ["SZ_POWER", "CHINA_MOBILE"], new_payee: "deny" },
      bills: { auto_pay_max: 300 },
      subscriptions: { cancel: "confirm" },
      prepaid: { escrow_only: true, max_prepay: 8000, auto_exit_on: ["closure_notice"] },
      global: { daily_outflow_cap: 1000 },
    },
    "CNY",
  ).policy;

describe("diffPolicies", () => {
  it("reports no change for an identical policy", () => {
    expect(diffPolicies(base(), base())).toEqual({ entries: [], class: "none" });
  });

  it("classes a lower cap as narrowing", () => {
    const to = base();
    to.bills.auto_pay_max = 200;
    const d = diffPolicies(base(), to);
    expect(d.class).toBe("narrowing");
    expect(d.entries).toEqual([{ path: "bills.auto_pay_max", from: 300, to: 200, class: "narrowing" }]);
  });

  it("classes a higher cap, a new payee or a looser action as widening", () => {
    const a = base();
    a.global.daily_outflow_cap = 5000;
    expect(diffPolicies(base(), a).class).toBe("widening");
    const b = base();
    b.payees.allow = [...b.payees.allow, "NEW_GUY"];
    expect(diffPolicies(base(), b).class).toBe("widening");
    const c = base();
    c.subscriptions.cancel = "deny";
    expect(diffPolicies(base(), c).class).toBe("narrowing");
  });

  it("treats turning escrow_only off as widening", () => {
    const to = base();
    to.prepaid.escrow_only = false;
    expect(diffPolicies(base(), to).entries[0].class).toBe("widening");
  });

  it("is widening if any entry widens", () => {
    const to = base();
    to.bills.auto_pay_max = 100; // narrowing
    to.prepaid.max_prepay = 20000; // widening
    expect(diffPolicies(base(), to).class).toBe("widening");
  });

  it("treats a first mandate as widening", () => {
    expect(diffPolicies(null, base()).class).toBe("widening");
  });
});

describe("withDefaults", () => {
  it("produces a policy the core schema (and so the Gate) accepts", () => {
    expect(parsePolicy({ ...base(), version: 1 })).toEqual({ ok: true, policy: expect.anything() });
  });

  it("round-trips the seeded mandate with no diff", () => {
    const active = { ...LIN_MANDATE_V3 } as Record<string, unknown>;
    delete active.version;
    const draft = { ...active };
    delete draft.base_currency;
    const { policy } = withDefaults(draft as PolicyDraft, "CNY");
    expect(diffPolicies(active as unknown as Policy, policy)).toEqual({ entries: [], class: "none" });
  });
});
