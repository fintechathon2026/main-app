import { describe, expect, it } from "vitest";
import type { GateSnapshot, Origin, PrepaidFacts, TypedAction } from "../types";
import { LIN_MANDATE_V3 } from "../mandate/examples";
import { decide } from "./decide";
import { medianMadCheck } from "./anomaly";

const NOW = "2026-10-17T08:00:00.000Z";
const OWNER = "0x1111111111111111111111111111111111111111";
const MERCHANT = "0x2222222222222222222222222222222222222222";
const AGENT = "0x3333333333333333333333333333333333333333";

type Patch = { [K in keyof GateSnapshot]?: GateSnapshot[K] };
type PolicyPatch = (p: Record<string, unknown>) => void;

function clonePolicy(patch?: PolicyPatch) {
  const p = JSON.parse(JSON.stringify(LIN_MANDATE_V3));
  patch?.(p);
  return p;
}

function snap(over: Patch = {}, policyPatch?: PolicyPatch): GateSnapshot {
  return {
    now: NOW,
    killSwitch: false,
    mandate: { version: 3, hash: "h3", policy: clonePolicy(policyPatch), signatureValid: true },
    provenance: { destinationOrigin: "registry", amountOrigin: "mock_bank", amountMatchesBill: true },
    payee: { billerId: "CHINA_MOBILE", inRegistry: true, verified: true },
    history: { amounts: [98, 98, 98, 98, 98] },
    fx: null,
    caps: { dailyUsed: 0, dailyCap: 1000 },
    approval: null,
    ...over,
  };
}

const pay = (amount = 98, billerId = "CHINA_MOBILE"): TypedAction => ({
  tool: "pay_bill",
  actor: "agent",
  args: { bill_id: "bill-1", biller_id: billerId, amount },
});
const cancel: TypedAction = { tool: "cancel_subscription", actor: "agent", args: { subscription_id: "sub-1" } };

const electricity = { payee: { billerId: "SZ_POWER", inRegistry: true, verified: true }, history: { amounts: [196, 214, 238, 205, 251, 222] } };

describe("decide: pipeline basics", () => {
  it("allows a normal small bill from mock_bank", () => {
    const r = decide(pay(), snap());
    expect(r.decision).toBe("allow");
    expect(r.mandateVersion).toBe(3);
    expect(r.amountBase).toBe(98);
    expect(r.trace.map((x) => x.ruleId)).toEqual(
      expect.arrayContaining(["global.kill_switch", "mandate.valid", "schema.pay_bill", "bills.anomaly", "global.daily_outflow_cap"]),
    );
  });

  it.each([
    ["kill switch on", snap({ killSwitch: true }), "global.kill_switch"],
    ["no mandate", snap({ mandate: null }), "mandate.valid"],
    ["bad signature", snap({ mandate: { version: 3, hash: "h", policy: LIN_MANDATE_V3, signatureValid: false } }), "mandate.valid"],
    ["invalid policy", snap({ mandate: { version: 3, hash: "h", policy: { version: 3 }, signatureValid: true } }), "mandate.valid"],
    ["version mismatch", snap({ mandate: { version: 4, hash: "h", policy: LIN_MANDATE_V3, signatureValid: true } }), "mandate.valid"],
    [
      "expired mandate",
      snap({}, (p) => {
        (p.global as Record<string, unknown>).expires_at = "2026-10-16T00:00:00Z";
      }),
      "mandate.valid",
    ],
  ])("denies: %s", (_name, s, rule) => {
    const r = decide(pay(), s);
    expect(r.decision).toBe("deny");
    expect(r.ruleIds).toContain(rule);
  });

  it("kill switch short-circuits even a pre-approved action", () => {
    const r = decide(pay(), snap({ killSwitch: true, approval: { valid: true } }));
    expect(r.decision).toBe("deny");
  });

  it.each([
    ["extra account field", { bill_id: "b", biller_id: "CHINA_MOBILE", amount: 98, account: "8812" }],
    ["non-integer amount", { bill_id: "b", biller_id: "CHINA_MOBILE", amount: 98.5 }],
    ["negative amount", { bill_id: "b", biller_id: "CHINA_MOBILE", amount: -1 }],
    ["missing bill id", { biller_id: "CHINA_MOBILE", amount: 98 }],
  ])("schema denies %s", (_n, args) => {
    const r = decide({ tool: "pay_bill", actor: "agent", args } as unknown as TypedAction, snap());
    expect(r.decision).toBe("deny");
    expect(r.ruleIds).toEqual(["schema.pay_bill"]);
  });

  it("denies an agent action submitted as a user action", () => {
    const r = decide({ ...pay(), actor: "user" } as unknown as TypedAction, snap());
    expect(r.decision).toBe("deny");
  });
});

describe("decide: provenance matrix (PRD §10.3)", () => {
  const rows: { name: string; dest: Origin | null; amountOrigin: Origin | null; matches: boolean; amount?: number; expected: string; rule: string }[] = [
    { name: "registry + mock_bank", dest: "registry", amountOrigin: "mock_bank", matches: true, expected: "allow", rule: "provenance.amount" },
    { name: "registry + aggregator", dest: "registry", amountOrigin: "aggregator", matches: true, expected: "allow", rule: "provenance.amount" },
    { name: "destination from document", dest: "document", amountOrigin: "mock_bank", matches: true, expected: "deny", rule: "provenance.destination" },
    { name: "destination from email", dest: "email", amountOrigin: "mock_bank", matches: true, expected: "deny", rule: "provenance.destination" },
    { name: "destination unknown", dest: null, amountOrigin: "mock_bank", matches: true, expected: "deny", rule: "provenance.destination" },
    { name: "amount mismatch", dest: "registry", amountOrigin: "mock_bank", matches: false, expected: "deny", rule: "provenance.amount_mismatch" },
    { name: "document amount, small, normal", dest: "registry", amountOrigin: "document", matches: true, expected: "allow", rule: "provenance.amount" },
    { name: "email amount, small, normal", dest: "registry", amountOrigin: "email", matches: true, expected: "allow", rule: "provenance.amount" },
    { name: "document amount, anomalous", dest: "registry", amountOrigin: "document", matches: true, amount: 120, expected: "require_confirm", rule: "provenance.amount" },
    { name: "csv amount", dest: "registry", amountOrigin: "csv", matches: true, expected: "require_confirm", rule: "provenance.amount" },
    { name: "web amount", dest: "registry", amountOrigin: "web", matches: true, expected: "require_confirm", rule: "provenance.amount" },
    { name: "notification amount", dest: "registry", amountOrigin: "notification", matches: true, expected: "require_confirm", rule: "provenance.amount" },
    { name: "unknown amount origin", dest: "registry", amountOrigin: null, matches: true, expected: "require_confirm", rule: "provenance.amount" },
  ];
  it.each(rows)("$name → $expected", ({ dest, amountOrigin, matches, amount, expected, rule }) => {
    const r = decide(pay(amount ?? 98), snap({ provenance: { destinationOrigin: dest, amountOrigin, amountMatchesBill: matches } }));
    expect(r.decision).toBe(expected);
    expect(r.trace.find((x) => x.ruleId === rule)?.result).toBe(expected === "allow" ? "allow" : expected);
  });

  it("denies when the payee row is for a different biller than the args", () => {
    const r = decide(pay(98, "SZ_POWER"), snap());
    expect(r.decision).toBe("deny");
    expect(r.ruleIds).toContain("provenance.destination");
  });

  it("an approval never upgrades a provenance deny", () => {
    const r = decide(pay(), snap({ provenance: { destinationOrigin: "registry", amountOrigin: "mock_bank", amountMatchesBill: false }, approval: { valid: true } }));
    expect(r.decision).toBe("deny");
    expect(r.ruleIds).toContain("provenance.amount_mismatch");
  });
});

describe("decide: payees", () => {
  it("denies a payee outside the allowlist with new_payee deny", () => {
    const r = decide(pay(98, "KOS_X"), snap({ payee: { billerId: "KOS_X", inRegistry: true, verified: true } }));
    expect(r.decision).toBe("deny");
    expect(r.ruleIds).toContain("payees.new_payee");
  });
  it("confirms a payee outside the allowlist with new_payee confirm", () => {
    const r = decide(
      pay(98, "KOS_X"),
      snap({ payee: { billerId: "KOS_X", inRegistry: true, verified: true } }, (p) => {
        (p.payees as Record<string, unknown>).new_payee = "confirm";
      }),
    );
    expect(r.decision).toBe("require_confirm");
  });
  it("treats an unverified registry payee as new", () => {
    const r = decide(pay(), snap({ payee: { billerId: "CHINA_MOBILE", inRegistry: true, verified: false } }));
    expect(r.decision).toBe("deny");
  });
});

describe("decide: amount, FX, anomaly, caps, approval", () => {
  it("requires confirmation above auto_pay_max (rent)", () => {
    const r = decide(
      pay(4500, "LANDLORD_WANG"),
      snap({ payee: { billerId: "LANDLORD_WANG", inRegistry: true, verified: true }, history: { amounts: [4500, 4500, 4500] }, caps: { dailyUsed: 0, dailyCap: 10000 } }, (p) => {
        (p.global as Record<string, unknown>).daily_outflow_cap = 10000;
      }),
    );
    expect(r.decision).toBe("require_confirm");
    expect(r.ruleIds).toContain("bills.auto_pay_max");
  });

  it("flags the anomalous ¥612 electricity bill (and it exceeds auto_pay_max)", () => {
    const r = decide(pay(612, "SZ_POWER"), snap(electricity));
    expect(r.decision).toBe("require_confirm");
    expect(r.ruleIds).toEqual(expect.arrayContaining(["bills.anomaly", "bills.auto_pay_max"]));
  });

  it("allows a normal electricity bill", () => {
    expect(decide(pay(231, "SZ_POWER"), snap(electricity)).decision).toBe("allow");
  });

  it("confirms when history is shorter than min_history", () => {
    const r = decide(pay(), snap({ history: { amounts: [98, 98] } }));
    expect(r.decision).toBe("require_confirm");
    expect(r.ruleIds).toEqual(["bills.anomaly", "approval.valid"]);
  });

  it("upgrades require_confirm to allow with a valid approval", () => {
    const r = decide(pay(612, "SZ_POWER"), snap({ ...electricity, approval: { valid: true } }));
    expect(r.decision).toBe("allow");
    expect(r.ruleIds).toContain("approval.valid");
  });

  it("keeps require_confirm with an invalid approval", () => {
    const r = decide(pay(612, "SZ_POWER"), snap({ ...electricity, approval: { valid: false, reason: "expired" } }));
    expect(r.decision).toBe("require_confirm");
    expect(r.reasons).toContain("approval.expired");
  });

  it("denies over the daily cap even with an approval", () => {
    const r = decide(pay(612, "SZ_POWER"), snap({ ...electricity, caps: { dailyUsed: 500, dailyCap: 1000 }, approval: { valid: true } }));
    expect(r.decision).toBe("deny");
    expect(r.ruleIds).toEqual(["global.daily_outflow_cap"]);
  });

  it("uses the stricter of snapshot and policy caps", () => {
    expect(decide(pay(), snap({ caps: { dailyUsed: 950, dailyCap: 5000 } })).decision).toBe("deny");
  });

  it("enforces per-payee caps", () => {
    const r = decide(
      pay(),
      snap({ caps: { dailyUsed: 0, dailyCap: 1000, perPayeeUsed: 98 } }, (p) => {
        (p.global as Record<string, unknown>).per_payee_daily_cap = { CHINA_MOBILE: 150 };
      }),
    );
    expect(r.decision).toBe("deny");
    expect(r.ruleIds).toContain("global.per_payee_daily_cap");
  });

  it("converts foreign amounts with margin and checks caps on the converted value", () => {
    const r = decide(pay(20), snap({ fx: { rate: 7.1, date: "2026-10-16", source: "fx_provider" }, history: { amounts: [147, 147, 147] } }));
    expect(r.amountBase).toBe(Math.ceil(20 * 7.1 * 1.03));
    expect(r.trace.find((x) => x.ruleId === "fx.rate_fresh")?.result).toBe("allow");
  });

  it("compares a foreign bill with history in its own currency, not the converted amount", () => {
    const r = decide(pay(20), snap({ fx: { rate: 7.1, date: "2026-10-16", source: "fx_provider" }, history: { amounts: [20, 20, 20, 20, 20] } }));
    expect(r.trace.find((x) => x.ruleId === "bills.anomaly")?.result).toBe("allow");
    expect(r.amountBase).toBe(Math.ceil(20 * 7.1 * 1.03));
  });

  it("flags a foreign bill that is anomalous in its own currency", () => {
    const r = decide(pay(40), snap({ fx: { rate: 7.1, date: "2026-10-16", source: "fx_provider" }, history: { amounts: [20, 20, 20, 20, 20] } }));
    expect(r.trace.find((x) => x.ruleId === "bills.anomaly")?.result).toBe("require_confirm");
  });

  it("denies a stale FX rate", () => {
    const r = decide(pay(20), snap({ fx: { rate: 7.1, date: "2026-10-10", source: "fx_provider" }, history: { amounts: [147, 147, 147] } }));
    expect(r.decision).toBe("deny");
    expect(r.ruleIds).toContain("fx.rate_fresh");
  });
});

describe("medianMadCheck (PRD §15.2)", () => {
  it.each([
    [612, [196, 214, 238, 205, 251, 222], 3, 3, true],
    [231, [196, 214, 238, 205, 251, 222], 3, 3, false],
    [98, [98, 98, 98], 3, 3, false],
    [99, [98, 98, 98], 3, 3, true],
    [98, [98, 98], 3, 3, true],
  ])("x=%d history=%j k=%d min=%d → anomalous=%s", (x, h, k, min, expected) => {
    expect(medianMadCheck(x, h, k, min).anomalous).toBe(expected);
  });
});

describe("decide: subscriptions", () => {
  const trial = { status: "trial", isTrial: true, trialOrigin: "mock_bank" as Origin, keepFlag: false, noticeSent: true };
  it("auto-cancels a trusted trial when every condition holds (T3)", () => {
    const r = decide(cancel, snap({ subscription: trial }));
    expect(r.decision).toBe("allow");
    expect(r.ruleIds).toContain("subscriptions.auto_cancel_trials");
  });
  it.each([
    ["trial origin from email", { ...trial, trialOrigin: "email" as Origin }],
    ["keep flag set", { ...trial, keepFlag: true }],
    ["notice not sent", { ...trial, noticeSent: false }],
    ["not a trial", { ...trial, isTrial: false, status: "active" }],
  ])("requires confirmation: %s", (_n, sub) => {
    expect(decide(cancel, snap({ subscription: sub })).decision).toBe("require_confirm");
  });
  it("requires confirmation when auto_cancel_trials is disabled", () => {
    const r = decide(
      cancel,
      snap({ subscription: trial }, (p) => {
        ((p.subscriptions as Record<string, unknown>).auto_cancel_trials as Record<string, unknown>).enabled = false;
      }),
    );
    expect(r.decision).toBe("require_confirm");
  });
  it("denies when the mandate denies cancellation", () => {
    const r = decide(
      cancel,
      snap({ subscription: { ...trial, isTrial: false } }, (p) => {
        (p.subscriptions as Record<string, unknown>).cancel = "deny";
      }),
    );
    expect(r.decision).toBe("deny");
  });
  it("denies cancelling an unknown subscription", () => {
    expect(decide(cancel, snap()).decision).toBe("deny");
  });
  it("one-tap approval allows a normal cancel", () => {
    const r = decide(cancel, snap({ subscription: { ...trial, isTrial: false, status: "active" }, approval: { valid: true } }));
    expect(r.decision).toBe("allow");
    expect(r.amountBase).toBe(0);
  });
});

describe("decide: prepaid (architecture §24.9)", () => {
  const plan = { owner: OWNER, merchant: MERCHANT, agent: AGENT, status: "active" as const, unitPrice: 100, unitsLeft: 48, nextSession: 13 };
  const attestation = { signerIsOracle: true, kind: "court_enforcement" as const, merchantMatches: true, ageDays: 0.5, expired: false };
  const base = (over: Partial<PrepaidFacts>): PrepaidFacts => ({ actor: "agent", ownerWallet: OWNER, plan, ...over });
  const offer = { merchantSigValid: true, expired: false, termsMatchStored: true, escrowSupported: true, totalBase: 6000 };

  const purchase = (actor: "user" | "agent") => ({ tool: "prepaid_purchase", actor, args: { offer_id: "o1" } }) as unknown as TypedAction;
  const redeem = (n = 13): TypedAction => ({ tool: "prepaid_redeem", actor: "user", args: { plan_id: "p1", session_no: n } });
  const exit: TypedAction = { tool: "prepaid_exit", actor: "agent", args: { plan_id: "p1" } };
  const voluntary: TypedAction = { tool: "prepaid_exit_voluntary", actor: "user", args: { plan_id: "p1" } };

  type Row = { name: string; action: TypedAction; facts: PrepaidFacts; expected: string; rule: string; over?: Patch; patch?: PolicyPatch };
  const rows: Row[] = [
    { name: "agent purchase", action: purchase("agent"), facts: base({ offer, consumerSigValid: true }), expected: "deny", rule: "prepaid.agent_cannot_purchase" },
    { name: "user purchase, all valid", action: purchase("user"), facts: base({ actor: "user", offer, consumerSigValid: true }), expected: "allow", rule: "prepaid.purchase" },
    { name: "purchase without consumer sig", action: purchase("user"), facts: base({ actor: "user", offer, consumerSigValid: false }), expected: "deny", rule: "prepaid.purchase" },
    {
      name: "purchase with purchase: deny",
      action: purchase("user"),
      facts: base({ actor: "user", offer, consumerSigValid: true }),
      expected: "deny",
      rule: "prepaid.purchase",
      patch: (p) => {
        (p.prepaid as Record<string, unknown>).purchase = "deny";
      },
    },
    { name: "bad merchant sig", action: purchase("user"), facts: base({ actor: "user", offer: { ...offer, merchantSigValid: false }, consumerSigValid: true }), expected: "deny", rule: "prepaid.offer_valid" },
    { name: "expired offer", action: purchase("user"), facts: base({ actor: "user", offer: { ...offer, expired: true }, consumerSigValid: true }), expected: "deny", rule: "prepaid.offer_valid" },
    { name: "terms differ from stored", action: purchase("user"), facts: base({ actor: "user", offer: { ...offer, termsMatchStored: false }, consumerSigValid: true }), expected: "deny", rule: "prepaid.offer_valid" },
    { name: "no escrow with escrow_only", action: purchase("user"), facts: base({ actor: "user", offer: { ...offer, escrowSupported: false }, consumerSigValid: true }), expected: "deny", rule: "prepaid.escrow_only" },
    {
      name: "no escrow with escrow_only false",
      action: purchase("user"),
      facts: base({ actor: "user", offer: { ...offer, escrowSupported: false }, consumerSigValid: true }),
      expected: "allow",
      rule: "prepaid.escrow_only",
      patch: (p) => {
        (p.prepaid as Record<string, unknown>).escrow_only = false;
      },
    },
    { name: "over max_prepay", action: purchase("user"), facts: base({ actor: "user", offer: { ...offer, totalBase: 9000 }, consumerSigValid: true }), expected: "deny", rule: "prepaid.max_prepay" },
    { name: "redeem, all valid", action: redeem(), facts: base({ actor: "user", consumerSigValid: true, merchantSigValid: true, sessionNo: 13 }), expected: "allow", rule: "prepaid.redeem" },
    { name: "redeem, single signature", action: redeem(), facts: base({ actor: "user", consumerSigValid: true, merchantSigValid: false, sessionNo: 13 }), expected: "deny", rule: "prepaid.redeem" },
    { name: "redeem, wrong session", action: redeem(14), facts: base({ actor: "user", consumerSigValid: true, merchantSigValid: true, sessionNo: 14 }), expected: "deny", rule: "prepaid.redeem" },
    { name: "redeem, other owner", action: redeem(), facts: base({ actor: "user", ownerWallet: AGENT, consumerSigValid: true, merchantSigValid: true }), expected: "deny", rule: "prepaid.redeem" },
    { name: "redeem, inactive plan", action: redeem(), facts: base({ actor: "user", plan: { ...plan, status: "exited_attested" }, consumerSigValid: true, merchantSigValid: true }), expected: "deny", rule: "prepaid.redeem" },
    {
      name: "redeem over daily cap",
      action: redeem(),
      facts: base({ actor: "user", consumerSigValid: true, merchantSigValid: true }),
      expected: "deny",
      rule: "global.daily_outflow_cap",
      over: { caps: { dailyUsed: 950, dailyCap: 1000 } },
    },
    { name: "attested exit, all valid", action: exit, facts: base({ agentIsOurs: true, attestation }), expected: "allow", rule: "prepaid.auto_exit_on" },
    // Without a valid attestation the exit is voluntary: deny unless the consumer signed it.
    { name: "exit, no attestation, unsigned", action: exit, facts: base({ agentIsOurs: true, attestation: null }), expected: "deny", rule: "prepaid.auto_exit_on" },
    { name: "exit, no attestation, consumer signed", action: exit, facts: base({ agentIsOurs: true, attestation: null, consumerSigValid: true }), expected: "require_confirm", rule: "prepaid.auto_exit_on" },
    { name: "exit, signer not oracle", action: exit, facts: base({ agentIsOurs: true, attestation: { ...attestation, signerIsOracle: false } }), expected: "deny", rule: "prepaid.auto_exit_on" },
    { name: "exit, signer not oracle, consumer signed", action: exit, facts: base({ agentIsOurs: true, attestation: { ...attestation, signerIsOracle: false }, consumerSigValid: true }), expected: "require_confirm", rule: "prepaid.auto_exit_on" },
    { name: "exit, other merchant", action: exit, facts: base({ agentIsOurs: true, attestation: { ...attestation, merchantMatches: false } }), expected: "deny", rule: "prepaid.auto_exit_on" },
    { name: "exit, stale attestation", action: exit, facts: base({ agentIsOurs: true, attestation: { ...attestation, ageDays: 3 } }), expected: "deny", rule: "prepaid.auto_exit_on" },
    { name: "exit, expired attestation", action: exit, facts: base({ agentIsOurs: true, attestation: { ...attestation, expired: true } }), expected: "deny", rule: "prepaid.auto_exit_on" },
    {
      name: "exit, kind not in auto_exit_on",
      action: exit,
      facts: base({ agentIsOurs: true, attestation: { ...attestation, kind: "closure_notice" } }),
      expected: "deny",
      rule: "prepaid.auto_exit_on",
      patch: (p) => {
        (p.prepaid as Record<string, unknown>).auto_exit_on = ["court_enforcement"];
      },
    },
    // The plan itself must be ours: deny, even with a consumer signature or an approval.
    { name: "exit, agent not ours", action: exit, facts: base({ agentIsOurs: false, attestation }), expected: "deny", rule: "prepaid.exit_plan" },
    { name: "exit, agent not ours, consumer signed", action: exit, facts: base({ agentIsOurs: false, attestation: null, consumerSigValid: true }), expected: "deny", rule: "prepaid.exit_plan" },
    { name: "exit, owner is not the user", action: exit, facts: base({ ownerWallet: AGENT, agentIsOurs: true, attestation }), expected: "deny", rule: "prepaid.exit_plan" },
    { name: "exit, inactive plan", action: exit, facts: base({ plan: { ...plan, status: "exited_voluntary" }, agentIsOurs: true, attestation, consumerSigValid: true }), expected: "deny", rule: "prepaid.exit_plan" },
    { name: "exit, unknown plan", action: exit, facts: base({ plan: null }), expected: "deny", rule: "provenance.prepaid_plan" },
    { name: "voluntary exit, signed", action: voluntary, facts: base({ actor: "user", consumerSigValid: true }), expected: "allow", rule: "prepaid.exit_voluntary" },
    { name: "voluntary exit, unsigned", action: voluntary, facts: base({ actor: "user", consumerSigValid: false }), expected: "deny", rule: "prepaid.exit_voluntary" },
  ];

  it.each(rows)("$name → $expected ($rule)", ({ action, facts, expected, rule, over, patch }) => {
    const r = decide(action, snap({ prepaid: facts, ...over }, patch));
    expect(r.decision).toBe(expected);
    expect(r.trace.some((x) => x.ruleId === rule)).toBe(true);
    if (expected !== "allow") expect(r.ruleIds).toContain(rule);
  });

  it("an approval never turns an unsigned, unattested exit into allow", () => {
    const r = decide(exit, snap({ prepaid: base({ agentIsOurs: true, attestation: null }), approval: { valid: true } }));
    expect(r.decision).toBe("deny");
    expect(r.reasons).toContain("prepaid.exit_use_voluntary_flow");
    const other = decide(exit, snap({ prepaid: base({ ownerWallet: AGENT, agentIsOurs: true, attestation: null, consumerSigValid: true }), approval: { valid: true } }));
    expect(other.decision).toBe("deny");
  });

  it("an approval with the consumer's signature confirms a voluntary-style exit", () => {
    const r = decide(exit, snap({ prepaid: base({ agentIsOurs: true, attestation: null, consumerSigValid: true }), approval: { valid: true } }));
    expect(r.decision).toBe("allow");
    expect(r.ruleIds).toContain("approval.valid");
  });

  it("kill switch denies every prepaid action", () => {
    for (const a of [exit, voluntary, redeem()]) {
      expect(decide(a, snap({ killSwitch: true, prepaid: base({ agentIsOurs: true, attestation }) })).decision).toBe("deny");
    }
  });

  it("escrow deposits do not count toward the daily cap", () => {
    const r = decide(purchase("user"), snap({ prepaid: base({ actor: "user", offer, consumerSigValid: true }), caps: { dailyUsed: 1000, dailyCap: 1000 } }));
    expect(r.decision).toBe("allow");
    expect(r.amountBase).toBe(0);
  });

  it("session releases count toward the daily cap", () => {
    const r = decide(redeem(), snap({ prepaid: base({ actor: "user", consumerSigValid: true, merchantSigValid: true }) }));
    expect(r.amountBase).toBe(100);
  });
});

describe("decide: determinism", () => {
  it("returns identical results for identical inputs", () => {
    const s = snap(electricity);
    expect(decide(pay(612, "SZ_POWER"), s)).toEqual(decide(pay(612, "SZ_POWER"), s));
  });
});
